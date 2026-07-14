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
const JOB_TIMEOUT_MS = 10 * 60 * 1000;  // treo > 10 phút -> fail để không kẹt slot mãi

const runners = new Map();      // batchId -> { paused, cancelled }

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const insertJob = db.prepare(`
  INSERT INTO video_jobs (user_id, batch_id, prompt_id, prompt_text, attempt_index,
    provider, model_id, status, payload)
  VALUES (@user_id, @batch_id, @prompt_id, @prompt_text, @attempt_index,
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
function buildJobsFromPrompts(userId, batchId, prompts, provider, modelId, basePayload) {
  const jobs = [];
  const tx = db.transaction(() => {
    for (const p of prompts) {
      const count = Math.max(1, parseInt(p.videoCount, 10) || 1);
      for (let i = 1; i <= count; i++) {
        const payload = { ...basePayload, prompt: p.promptText };
        const info = insertJob.run({
          user_id: userId, batch_id: batchId, prompt_id: String(p.id),
          prompt_text: p.promptText, attempt_index: i, provider, model_id: modelId,
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

async function runQueue(cfg, jobs, concurrency, control) {
  const limit = Math.max(1, parseInt(concurrency, 10) || 2);
  const queue = [...jobs];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length && !control.cancelled) {
      while (control.paused && !control.cancelled) await sleep(500);
      const job = queue.shift();
      if (!job) break;
      await runJob(cfg, job, control);
    }
  });
  await Promise.all(workers);
}

// Kick off a batch in the background; returns immediately.
function startBatch({ userId, batchId, cfg, jobs, concurrency }) {
  const control = { paused: false, cancelled: false };
  runners.set(batchId, control);
  runQueue(cfg, jobs, concurrency, control)
    .catch((e) => log(userId, "video_queue_error", e.message))
    .finally(() => runners.delete(batchId));
  return control;
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
};
