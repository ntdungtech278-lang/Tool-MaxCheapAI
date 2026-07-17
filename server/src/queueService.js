// queueService + videoProviderService.
//
// buildJobsFromPrompts: for each prompt, create `videoCount` jobs (attemptIndex 1..N).
// runQueue: submit jobs respecting a concurrency cap, poll each until success/failed.
// retryWithBackoff: on 429, reschedule with exponential backoff instead of spamming.
//
// One in-memory runner per batch. Job state is persisted in `video_jobs` so the UI
// can poll GET /video-jobs/:batchId and progress survives a page reload.

const db = require("./db");
const log = require("./log");
const maxcheapai = require("./maxcheapai");
const { validateVideoPayload } = require("./videoValidate");

const POLL_MS = 15000;          // 10–20s window; poll every 15s
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 5000;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;  // treo > 5 phút -> fail, worker nhả slot chạy prompt kế

const runners = new Map();      // batchId -> { paused, cancelled }

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const insertJob = db.prepare(`
  INSERT INTO video_jobs (user_id, project_id, batch_id, batch_name, prompt_id, prompt_text, attempt_index,
    provider, model_id, status, payload)
  VALUES (@user_id, @project_id, @batch_id, @batch_name, @prompt_id, @prompt_text, @attempt_index,
    @provider, @model_id, 'queued', @payload)`);

const updateJob = db.prepare(`
  UPDATE video_jobs SET status=@status, request_id=@request_id, result_url=@result_url,
    thumbnail_url=@thumbnail_url, error_message=@error_message, retries=@retries,
    updated_at=@updated_at WHERE id=@id`);

function patchJob(job, patch) {
  Object.assign(job, patch, { updated_at: now() });
  updateJob.run({
    id: job.id, status: job.status, request_id: job.request_id || "",
    result_url: job.result_url || "", thumbnail_url: job.thumbnail_url || "",
    error_message: job.error_message || "", retries: job.retries || 0,
    updated_at: job.updated_at,
  });
}

// prompts: [{ id, promptText, videoCount }]. Returns created job rows.
function buildJobsFromPrompts(userId, batchId, prompts, provider, modelId, basePayload, projectId = null, batchName = "") {
  const jobs = [];
  const tx = db.transaction(() => {
    for (const p of prompts) {
      const count = Math.max(1, parseInt(p.videoCount, 10) || 1);
      for (let i = 1; i <= count; i++) {
        const payload = { ...basePayload, prompt: p.promptText };
        // Ảnh đầu/cuối riêng của prompt này (nếu có).
        if (p.startFrame?.url) payload.startFrame = p.startFrame;
        if (p.endFrame?.url) payload.endFrame = p.endFrame;
        const info = insertJob.run({
          user_id: userId, project_id: projectId, batch_id: batchId, batch_name: batchName,
          prompt_id: String(p.id), prompt_text: p.promptText, attempt_index: i, provider, model_id: modelId,
          payload: JSON.stringify(payload),
        });
        jobs.push({ id: info.lastInsertRowid, status: "queued", retries: 0,
          request_id: "", result_url: "", thumbnail_url: "", error_message: "",
          payload, provider, model_id: modelId });
      }
    }
  });
  tx();
  return jobs;
}

// Insert 1 job đơn (dùng cho revise): kèm parent_job_id + version + frames trong payload.
const insertOneJob = db.prepare(`
  INSERT INTO video_jobs (user_id, project_id, batch_id, batch_name, prompt_id, prompt_text,
    attempt_index, provider, model_id, status, payload, parent_job_id, version)
  VALUES (@user_id, @project_id, @batch_id, @batch_name, @prompt_id, @prompt_text,
    @attempt_index, @provider, @model_id, 'queued', @payload, @parent_job_id, @version)`);

// Tạo 1 job "tạo lại" từ video gốc: cùng batch/prompt, payload mới, version tăng dần.
function buildReviseJob({ src, payload, provider, modelId, parentJobId, version }) {
  const info = insertOneJob.run({
    user_id: src.user_id, project_id: src.project_id, batch_id: src.batch_id,
    batch_name: src.batch_name || "", prompt_id: src.prompt_id, prompt_text: payload.prompt,
    attempt_index: src.attempt_index, provider, model_id: modelId,
    payload: JSON.stringify(payload), parent_job_id: parentJobId, version,
  });
  return {
    id: info.lastInsertRowid, status: "queued", retries: 0, request_id: "", result_url: "",
    thumbnail_url: "", error_message: "", payload, provider, model_id: modelId,
  };
}

// Tạo lại (reload) 1 video LỖI: bản mới cùng batch/prompt, giữ payload cũ, là ATTEMPT mới
// (attempt_index kế tiếp trong prompt), version=1, không parent. Trả job để đưa vào hàng đợi.
function buildRetryJob(src) {
  let payload = {}; try { payload = JSON.parse(src.payload || "{}"); } catch {}
  const maxAtt = db.prepare("SELECT MAX(attempt_index) a FROM video_jobs WHERE batch_id=? AND prompt_id=?")
    .get(src.batch_id, src.prompt_id).a || src.attempt_index || 1;
  const info = insertOneJob.run({
    user_id: src.user_id, project_id: src.project_id, batch_id: src.batch_id,
    batch_name: src.batch_name || "", prompt_id: src.prompt_id, prompt_text: src.prompt_text,
    attempt_index: maxAtt + 1, provider: src.provider, model_id: src.model_id,
    payload: JSON.stringify(payload), parent_job_id: null, version: 1,
  });
  return {
    id: info.lastInsertRowid, status: "queued", retries: 0, request_id: "", result_url: "",
    thumbnail_url: "", error_message: "", payload, provider: src.provider, model_id: src.model_id,
  };
}

// Chạy nền 1 job (revise) tới khi xong. Không dùng runner theo batch để tránh khóa slot lượt.
function runSingleJob(cfg, job) {
  const control = { paused: false, cancelled: false };
  runJob(cfg, job, control).catch(() => {});
  return job;
}

// ---- videoProviderService: single-job lifecycle ----

async function submitVideoJob(cfg, job) {
  const v = validateVideoPayload(job.provider, job.model_id, job.payload);
  if (!v.ok) { patchJob(job, { status: "failed", error_message: v.errors.join("; ") }); return; }
  patchJob(job, { status: "submitting" });
  const resp = await maxcheapai.generateVideo(cfg, job.payload);
  patchJob(job, { status: "processing", request_id: String(resp.requestId ?? "") });
}

async function pollVideoJob(cfg, job, control) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (!control.cancelled) {
    if (control.paused) { await sleep(1000); continue; }
    if (Date.now() > deadline) {
      patchJob(job, { status: "failed",
        error_message: `Quá thời gian chờ (> ${JOB_TIMEOUT_MS / 60000} phút) — có thể provider bị treo` });
      return;
    }
    await sleep(POLL_MS);
    let g;
    try { g = await maxcheapai.getVideoGeneration(cfg, job.request_id); }
    catch (e) {
      // 429 hoặc timeout mạng khi poll: bỏ qua vòng này, tiếp tục tới khi chạm deadline tổng.
      if (e.status === 429) { await sleep(BACKOFF_BASE_MS); continue; }
      if (e.status === 0) { continue; }
      throw e;
    }
    const st = String(g.status || "").toLowerCase();
    if (st === "success" || st === "succeeded" || st === "completed") {
      patchJob(job, { status: "success",
        result_url: g.resultVideoUrl || g.videoUrl || "", thumbnail_url: g.thumbnailUrl || "" });
      return;
    }
    if (st === "failed" || st === "error") {
      patchJob(job, { status: "failed", error_message: g.error || g.errorMessage || "failed" });
      return;
    }
    // pending / processing -> keep polling
  }
}

// Run one job to completion, with 429 backoff on submit.
async function runJob(cfg, job, control) {
  for (let attempt = 0; ; attempt++) {
    try {
      await submitVideoJob(cfg, job);
      await pollVideoJob(cfg, job, control);
      return;
    } catch (e) {
      if (e.status === 429 && job.retries < MAX_RETRIES) {
        job.retries += 1;
        patchJob(job, { status: "queued", error_message: `429 — chờ retry (${job.retries}/${MAX_RETRIES})` });
        await sleep(BACKOFF_BASE_MS * 2 ** (job.retries - 1)); // exponential backoff
        continue;
      }
      patchJob(job, { status: "failed", error_message: e.message });
      return;
    }
  }
}

// ---- queueService: concurrency-limited runner ----
// control.queue là hàng đợi ĐỘNG: worker lấy job từ đây. Có thể push thêm job (retry)
// trong lúc runner còn sống -> job mới CHỜ tới khi có slot trống (đúng nghĩa hàng đợi).
// Runner tự đóng khi: hết queue + không còn job đang chạy (active===0) + qua 1 nhịp lặng.

async function runQueue(cfg, concurrency, control) {
  const limit = Math.max(1, parseInt(concurrency, 10) || 2);
  control.active = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (!control.cancelled) {
      while (control.paused && !control.cancelled) await sleep(500);
      if (control.cancelled) break;
      const job = control.queue.shift();
      if (!job) {
        // Không còn job chờ và không job đang chạy -> runner rảnh, thoát.
        if (control.active === 0) break;
        await sleep(400); // còn job đang chạy: chờ (có thể retry được đẩy vào)
        continue;
      }
      control.active++;
      try { await runJob(cfg, job, control); }
      finally { control.active--; }
    }
  });
  await Promise.all(workers);
}

// Kick off a batch in the background; returns immediately.
function startBatch({ userId, batchId, cfg, jobs, concurrency }) {
  const control = { paused: false, cancelled: false, queue: [...jobs], active: 0, cfg,
    limit: Math.max(1, parseInt(concurrency, 10) || 2) };
  runners.set(batchId, control);
  runQueue(cfg, control.limit, control)
    .catch((e) => log(userId, "video_queue_error", e.message))
    .finally(() => runners.delete(batchId));
  return control;
}

// Đẩy 1 job (retry) vào runner của batch nếu còn sống; else khởi động runner mới cho riêng job đó.
// Job luôn TÔN TRỌNG concurrency: chờ slot trống rồi mới chạy -> UI hiện "Chờ" như video khác.
function enqueueJob(batchId, userId, cfg, job, concurrency = 2) {
  const c = runners.get(batchId);
  if (c && !c.cancelled) { c.queue.push(job); return; } // vào CUỐI hàng đợi lượt đang chạy
  const control = { paused: false, cancelled: false, queue: [job], active: 0, cfg,
    limit: Math.max(1, parseInt(concurrency, 10) || 2) };
  runners.set(batchId, control);
  runQueue(cfg, control.limit, control)
    .catch((e) => log(userId, "video_queue_error", e.message))
    .finally(() => runners.delete(batchId));
}

function pauseBatch(batchId) { const c = runners.get(batchId); if (c) c.paused = true; }
function resumeBatch(batchId) { const c = runners.get(batchId); if (c) c.paused = false; }
function cancelBatch(batchId) {
  const c = runners.get(batchId); if (c) c.cancelled = true;
  db.prepare(`UPDATE video_jobs SET status='failed', error_message='đã hủy', updated_at=?
    WHERE batch_id=? AND status IN ('queued','submitting','processing')`).run(now(), batchId);
}

function getBatchJobs(batchId) {
  return db.prepare("SELECT * FROM video_jobs WHERE batch_id=? ORDER BY id").all(batchId);
}

module.exports = {
  buildJobsFromPrompts, submitVideoJob, pollVideoJob, runQueue,
  startBatch, pauseBatch, resumeBatch, cancelBatch, getBatchJobs,
  buildReviseJob, runSingleJob, buildRetryJob, enqueueJob,
};
