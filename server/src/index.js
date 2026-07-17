const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");
const log = require("./log");
const { sign, authRequired, adminRequired } = require("./auth");
const { generate, testConnection, testAndListModels } = require("./llm");
const { buildIdeaSystem, buildPromptSeriesSystem, buildPromptSeriesUser, splitPrompts } = require("./styleTemplates");
const { getVideoEffectSystemPrompt, listEffects, DEFAULT_EFFECT } = require("./videoEffects");
const cfgSvc = require("./configService");
const queue = require("./queueService");
const maxcheapai = require("./maxcheapai");
const googleSheets = require("./googleSheets");
const { validateVideoPayload } = require("./videoValidate");
const crypto = require("crypto");

const DEBUG = process.env.DEBUG_API === "1";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // đủ cho ảnh đầu/cuối gửi dạng base64

const publicUser = (u) => ({
  id: u.id, username: u.username, full_name: u.full_name,
  employee_code: u.employee_code, phone: u.phone, email: u.email,
  role: u.role, active: !!u.active, created_at: u.created_at,
});

// ---- Auth ----
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.password_hash))
    return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
  if (!user.active) return res.status(403).json({ error: "Tài khoản đã bị dừng hoạt động" });
  log(user.id, "login");
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get("/api/me", authRequired, (req, res) => res.json(publicUser(req.user)));

// ---- Admin: user management ----
app.get("/api/users", authRequired, adminRequired, (req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY id").all().map(publicUser));
});

app.post("/api/users", authRequired, adminRequired, (req, res) => {
  const { username, password, full_name, employee_code, phone, email, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Thiếu username/password" });
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
    return res.status(409).json({ error: "Username đã tồn tại" });
  const info = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, employee_code, phone, email, role, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(username, bcrypt.hashSync(password, 10), full_name || "", employee_code || "",
        phone || "", email || "", role === "admin" ? "admin" : "user");
  log(req.user.id, "create_user", username);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid)));
});

app.put("/api/users/:id", authRequired, adminRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
  const { full_name, employee_code, phone, email, role, active, password } = req.body || {};
  db.prepare(
    `UPDATE users SET full_name=?, employee_code=?, phone=?, email=?, role=?, active=? WHERE id=?`
  ).run(
    full_name ?? user.full_name, employee_code ?? user.employee_code,
    phone ?? user.phone, email ?? user.email,
    (role === "admin" || role === "user") ? role : user.role,
    active === undefined ? user.active : (active ? 1 : 0), user.id
  );
  if (password) db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password, 10), user.id);
  log(req.user.id, "update_user", user.username);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(user.id)));
});

// ---- Admin: third-party API settings ----
// Keys are masked on the way out; blank keys on the way in keep stored secrets.
app.get("/api/settings", authRequired, adminRequired, (req, res) => {
  res.json(cfgSvc.toClientSafe(cfgSvc.getSettings()));
});

app.put("/api/settings", authRequired, adminRequired, (req, res) => {
  const merged = cfgSvc.mergeSettings(req.body || {});
  cfgSvc.saveSettings(merged);
  log(req.user.id, "update_settings");
  res.json(cfgSvc.toClientSafe(merged));
});

// Test a model-prompt provider's connectivity. Returns status/message/endpoint, no key.
app.post("/api/model-prompt/test", authRequired, adminRequired, async (req, res) => {
  const { provider, cfg: override } = req.body || {};
  const { provider: p, cfg } = cfgSvc.getModelPromptConfig(provider);
  // Allow the client to test an unsaved endpoint/model, but the key stays server-side
  // unless explicitly provided (blank = use stored).
  const merged = { ...cfg, ...(override || {}), apiKey: override?.apiKey || cfg?.apiKey };
  const result = await testAndListModels(p, merged, { debug: DEBUG });
  res.json(result);
});

// Test the active video provider (MaxCheapAI) by listing generations (cheap, no HP).
app.post("/api/video-api/test", authRequired, adminRequired, async (req, res) => {
  const { provider } = req.body || {};
  const { provider: p, cfg } = cfgSvc.getVideoApiConfig(provider);
  try {
    if (!cfg?.apiKey) throw new Error("Thiếu API key cho MaxCheapAI");
    const maxcheapai = require("./maxcheapai");
    await maxcheapai.listVideoGenerations(cfg, 1);
    res.json({ ok: true, status: 200, message: "OK", endpoint: `${cfg.baseUrl}/video-generations` });
  } catch (e) {
    res.json({ ok: false, status: e.status || 0, message: e.message, endpoint: p });
  }
});

// MaxCheapAI model list + saved video settings, for the "Tạo video" tab controls.
app.get("/api/video-models", authRequired, (req, res) => {
  const { MAXCHEAP_MODELS } = require("./videoValidate");
  const { cfg, videoApi } = cfgSvc.getVideoApiConfig();
  res.json({
    models: Object.keys(MAXCHEAP_MODELS),
    defaultModelId: cfg?.modelId || "veo-3.1",
    // Cấu hình video đã lưu (không kèm key) để tab Tạo video khởi tạo các ô chọn.
    settings: {
      modelId: cfg?.modelId || "veo-3.1",
      speed: cfg?.speed ?? "normal",
      resolution: cfg?.resolution ?? "720p",
      duration: cfg?.duration ?? 8,
      aspectRatio: cfg?.aspectRatio ?? "16:9",
      generateAudio: cfg?.generateAudio ?? false,
      concurrency: videoApi?.concurrency ?? 2,
    },
  });
});

// Which prompt model is active (any logged-in user may read, keys stripped).
app.get("/api/active-model", authRequired, (req, res) => {
  const s = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='settings'").get().value);
  res.json({ promptModel: s.promptModel });
});

// ---- Projects (role-scoped) ----
app.get("/api/projects", authRequired, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(`SELECT p.*, u.username AS owner FROM projects p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC`).all()
    : db.prepare(`SELECT p.*, u.username AS owner FROM projects p JOIN users u ON u.id=p.user_id WHERE p.user_id=? ORDER BY p.id DESC`).all(req.user.id);
  res.json(rows);
});

app.post("/api/projects", authRequired, (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Thiếu tên dự án" });
  const info = db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run(req.user.id, name);
  log(req.user.id, "create_project", name);
  res.json(db.prepare("SELECT * FROM projects WHERE id=?").get(info.lastInsertRowid));
});

// Ownership check helper: returns project row if the user may access it.
function ownedProject(user, projectId) {
  const p = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
  if (!p) return null;
  if (user.role !== "admin" && p.user_id !== user.id) return null;
  return p;
}

// Cập nhật cấu hình dự án (hiện: định hướng prompt đầu ra).
app.put("/api/projects/:id", authRequired, (req, res) => {
  const project = ownedProject(req.user, req.params.id);
  if (!project) return res.status(403).json({ error: "Không có quyền" });
  const { output_config } = req.body || {};
  if (output_config !== undefined)
    db.prepare("UPDATE projects SET output_config=? WHERE id=?").run(String(output_config), project.id);
  res.json(db.prepare("SELECT * FROM projects WHERE id=?").get(project.id));
});

// Permanent delete; ON DELETE CASCADE removes the project's scenarios too.
app.delete("/api/projects/:id", authRequired, (req, res) => {
  const project = ownedProject(req.user, req.params.id);
  if (!project) return res.status(403).json({ error: "Không có quyền" });
  db.prepare("DELETE FROM projects WHERE id=?").run(project.id);
  log(req.user.id, "delete_project", project.name);
  res.json({ ok: true });
});

app.get("/api/projects/:id/scenarios", authRequired, (req, res) => {
  if (!ownedProject(req.user, req.params.id)) return res.status(403).json({ error: "Không có quyền" });
  res.json(db.prepare("SELECT * FROM scenarios WHERE project_id=? ORDER BY id DESC").all(req.params.id));
});

// ---- Video projects: dự án riêng của module Tạo video ----
function ownedVideoProject(user, id) {
  const p = db.prepare("SELECT * FROM video_projects WHERE id=?").get(id);
  if (!p) return null;
  if (user.role !== "admin" && p.user_id !== user.id) return null;
  return p;
}

app.get("/api/video-projects", authRequired, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(`SELECT vp.*, u.username AS owner FROM video_projects vp JOIN users u ON u.id=vp.user_id ORDER BY vp.id DESC`).all()
    : db.prepare(`SELECT vp.*, u.username AS owner FROM video_projects vp JOIN users u ON u.id=vp.user_id WHERE vp.user_id=? ORDER BY vp.id DESC`).all(req.user.id);
  res.json(rows);
});

app.post("/api/video-projects", authRequired, (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Thiếu tên dự án" });
  const info = db.prepare("INSERT INTO video_projects (user_id, name) VALUES (?, ?)").run(req.user.id, name);
  log(req.user.id, "create_video_project", name);
  res.json(db.prepare("SELECT * FROM video_projects WHERE id=?").get(info.lastInsertRowid));
});

app.delete("/api/video-projects/:id", authRequired, (req, res) => {
  const p = ownedVideoProject(req.user, req.params.id);
  if (!p) return res.status(403).json({ error: "Không có quyền" });
  db.prepare("DELETE FROM video_projects WHERE id=?").run(p.id); // CASCADE xóa video_jobs của dự án
  log(req.user.id, "delete_video_project", p.name);
  res.json({ ok: true });
});

// Mọi video (job) của 1 dự án, gom theo batch để hiển thị từng lượt tạo.
app.get("/api/video-projects/:id/batches", authRequired, (req, res) => {
  if (!ownedVideoProject(req.user, req.params.id)) return res.status(403).json({ error: "Không có quyền" });
  const rows = db.prepare("SELECT * FROM video_jobs WHERE project_id=? ORDER BY id").all(req.params.id);
  const byBatch = new Map();
  for (const j of rows) {
    let p = {}; try { p = JSON.parse(j.payload || "{}"); } catch {}
    const job = {
      id: j.id, promptId: j.prompt_id, attemptIndex: j.attempt_index, status: j.status,
      requestId: j.request_id, resultVideoUrl: j.result_url, thumbnailUrl: j.thumbnail_url,
      errorMessage: j.error_message, updatedAt: j.updated_at, createdAt: j.created_at,
      modelId: j.model_id, resolution: p.resolution, aspectRatio: p.aspectRatio, speed: p.speed, duration: p.duration,
      // Thông tin để tạo lại (revise) + hiển thị panel chi tiết.
      promptText: j.prompt_text, generateAudio: !!p.generateAudio,
      startFrame: p.startFrame || null, endFrame: p.endFrame || null,
      parentJobId: j.parent_job_id || null, version: j.version || 1,
    };
    if (!byBatch.has(j.batch_id)) byBatch.set(j.batch_id, { name: j.batch_name || "", jobs: [] });
    byBatch.get(j.batch_id).jobs.push(job);
  }
  const batches = [...byBatch.entries()].map(([batchId, { name, jobs }]) => {
    const count = (s) => jobs.filter((x) => x.status === s).length;
    return { batchId, batchName: name, total: jobs.length, jobs, success: count("success"), failed: count("failed"),
      processing: jobs.filter((x) => ["submitting", "processing", "queued"].includes(x.status)).length,
      createdAt: jobs[0]?.createdAt };
  });
  res.json({ batches });
});

// Tạo lại 1 video (revise): cùng lượt/prompt với video gốc, đặt cạnh nó, đánh version _v tăng dần.
// Body: { overrides:{model options}, prompt?, startFrame?, endFrame? }
app.post("/api/video-jobs/:id/revise", authRequired, async (req, res) => {
  const src = db.prepare("SELECT * FROM video_jobs WHERE id=?").get(req.params.id);
  if (!src) return res.status(404).json({ error: "Không tìm thấy video" });
  if (!src.project_id || !ownedVideoProject(req.user, src.project_id))
    return res.status(403).json({ error: "Không có quyền" });

  const { provider, cfg } = cfgSvc.getVideoApiConfig();
  if (!cfg?.apiKey) return res.status(400).json({ error: "Thiếu API key MaxCheapAI" });

  // Chuỗi sửa quy về GỐC (root = job không có parent). version kế tiếp = max trong chuỗi + 1.
  const rootId = src.parent_job_id || src.id;
  const maxV = db.prepare("SELECT MAX(version) v FROM video_jobs WHERE id=? OR parent_job_id=?").get(rootId, rootId).v || 1;
  const version = maxV + 1;

  const o = req.body?.overrides || {};
  let base = {}; try { base = JSON.parse(src.payload || "{}"); } catch {}
  const pick = (a, b) => (a === undefined || a === "" || a === null ? b : a);
  const modelId = pick(o.modelId, src.model_id);
  const prompt = String(req.body?.prompt ?? src.prompt_text ?? "").trim();
  const payload = {
    modelId,
    resolution: pick(o.resolution, base.resolution),
    duration: pick(o.duration, base.duration),
    speed: pick(o.speed, base.speed),
    aspectRatio: pick(o.aspectRatio, base.aspectRatio),
    generateAudio: o.generateAudio ?? base.generateAudio ?? false,
    prompt,
  };
  // Ảnh đầu/cuối: dùng giá trị mới nếu client gửi (kể cả null để xóa), else giữ của bản gốc.
  const sf = req.body?.startFrame !== undefined ? req.body.startFrame : base.startFrame;
  const ef = req.body?.endFrame !== undefined ? req.body.endFrame : base.endFrame;
  if (sf?.url) payload.startFrame = { url: sf.url };
  if (ef?.url) payload.endFrame = { url: ef.url };

  const v = validateVideoPayload(provider, modelId, payload);
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });

  const job = queue.buildReviseJob({ src, payload, provider, modelId, parentJobId: rootId, version });
  queue.runSingleJob(cfg, job);
  log(req.user.id, "video_revise", `job ${src.id} -> v${version} (${provider}/${modelId})`);
  res.json({ ok: true, jobId: job.id, version });
});

// OAuth Google Sheet: trả URL để user đăng nhập + cấp quyền (mở bằng browser).
app.get("/api/sheet/auth-url", authRequired, adminRequired, (req, res) => {
  const { clientId, clientSecret } = cfgSvc.getSheetConfig();
  if (!clientId || !clientSecret)
    return res.status(400).json({ error: "Chưa nhập OAuth Client ID/Secret (lưu cấu hình trước)" });
  try {
    const url = googleSheets.getAuthUrl(clientId, clientSecret);
    res.json({ url });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Google redirect về đây kèm ?code=... -> đổi lấy refresh token, lưu, trả trang đóng tab.
// Không dùng authRequired vì Google gọi trực tiếp (không có JWT của app).
app.get("/api/sheet/callback", async (req, res) => {
  const code = req.query.code;
  const err = req.query.error;
  const done = (msg, ok) => res.send(
    `<html><body style="font-family:sans-serif;background:#0f1218;color:#e6e8eb;text-align:center;padding:60px">
     <h2>${ok ? "✓ Kết nối Google thành công" : "✗ Kết nối thất bại"}</h2>
     <p>${msg}</p><p>Bạn có thể đóng tab này và quay lại ứng dụng.</p></body></html>`);
  if (err) return done(String(err), false);
  if (!code) return done("Thiếu mã xác thực.", false);
  try {
    const { clientId, clientSecret } = cfgSvc.getSheetConfig();
    const tokens = await googleSheets.exchangeCode(clientId, clientSecret, code);
    if (!tokens.refresh_token)
      return done("Không nhận được refresh token. Hãy thử lại (đảm bảo prompt=consent).", false);
    // Lấy email tài khoản để hiển thị trạng thái.
    let email = "";
    try {
      const oauth = googleSheets.clientFromRefresh(clientId, clientSecret, tokens.refresh_token);
      const oauth2 = require("googleapis").google.oauth2({ version: "v2", auth: oauth });
      const me = await oauth2.userinfo.get();
      email = me.data.email || "";
    } catch {}
    cfgSvc.saveSheetTokens({ refreshToken: tokens.refresh_token, connectedEmail: email });
    done(email ? `Đã kết nối: ${email}` : "Đã lưu quyền truy cập.", true);
  } catch (e) {
    done(`Lỗi: ${e.message}`, false);
  }
});

// Xuất prompt + ảnh đầu/cuối ra Google Sheet. Body: { title, items:[{prompt,startUrl,endUrl}] }.
app.post("/api/export-sheet", authRequired, async (req, res) => {
  const { title, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Không có nội dung để xuất" });
  const { clientId, clientSecret, refreshToken, folderId } = cfgSvc.getSheetConfig();
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Chưa cấu hình OAuth Google Sheet (Cấu hình API)" });
  if (!refreshToken) return res.status(400).json({ error: "Chưa kết nối Google. Vào Cấu hình API bấm 'Kết nối Google'." });
  try {
    const auth = googleSheets.clientFromRefresh(clientId, clientSecret, refreshToken);
    const r = await googleSheets.exportPromptsSheet({ auth, title, items, folderId });
    log(req.user.id, "export_sheet", `${items.length} rows -> ${r.spreadsheetId}`);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: `Lỗi xuất Sheet: ${e.message}` });
  }
});

// Reload 1 video LỖI: tạo bản mới cùng lượt/prompt (payload cũ), đẩy vào CUỐI hàng đợi.
// Job mới hiện trạng thái "Chờ" như video khác, tôn trọng concurrency.
app.post("/api/video-jobs/:id/retry", authRequired, (req, res) => {
  const src = db.prepare("SELECT * FROM video_jobs WHERE id=?").get(req.params.id);
  if (!src) return res.status(404).json({ error: "Không tìm thấy video" });
  if (!src.project_id || !ownedVideoProject(req.user, src.project_id))
    return res.status(403).json({ error: "Không có quyền" });
  const { provider, cfg, videoApi } = cfgSvc.getVideoApiConfig();
  if (!cfg?.apiKey) return res.status(400).json({ error: "Thiếu API key MaxCheapAI" });

  const job = queue.buildRetryJob(src);
  queue.enqueueJob(src.batch_id, req.user.id, cfg, job, videoApi?.concurrency || 2);
  log(req.user.id, "video_retry", `job ${src.id} -> ${job.id}`);
  res.json({ ok: true, jobId: job.id });
});

// Xóa vĩnh viễn 1 video (job) khỏi dự án. (Video kết quả nằm ở MaxCheapAI; đây xóa bản ghi + khỏi UI.)
app.delete("/api/video-jobs/:id", authRequired, (req, res) => {
  const j = db.prepare("SELECT * FROM video_jobs WHERE id=?").get(req.params.id);
  if (!j) return res.status(404).json({ error: "Không tìm thấy video" });
  if (!j.project_id || !ownedVideoProject(req.user, j.project_id))
    return res.status(403).json({ error: "Không có quyền" });
  db.prepare("DELETE FROM video_jobs WHERE id=?").run(j.id);
  log(req.user.id, "video_delete", `job ${j.id}`);
  res.json({ ok: true });
});

// ---- Prompt generation: mỗi ý tưởng (tách bởi \n\n) -> 1 prompt, giữ thứ tự ----
app.post("/api/projects/:id/scenarios", authRequired, async (req, res) => {
  const project = ownedProject(req.user, req.params.id);
  if (!project) return res.status(403).json({ error: "Không có quyền" });

  const { text, seconds } = req.body || {};
  const secs = parseInt(seconds, 10);
  // Tách ý tưởng bằng 1+ dòng trống; giữ nguyên thứ tự từ trên xuống.
  const ideas = String(text || "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  if (ideas.length === 0) return res.status(400).json({ error: "Thiếu nội dung ý tưởng" });
  if (!secs || secs < 1) return res.status(400).json({ error: "Thời lượng không hợp lệ" });

  const s = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='settings'").get().value);
  const provider = s.promptModel;
  const cfg = s.providers?.[provider];
  if (!cfg?.enabled) return res.status(400).json({ error: `Model "${provider}" chưa được bật trong Cấu hình API` });

  const system = buildIdeaSystem(secs, project.output_config);
  try {
    // Gọi LLM tuần tự theo thứ tự ý tưởng để giữ đúng thứ tự prompt đầu ra.
    const prompts = [];
    for (const idea of ideas) {
      const out = await generate(provider, cfg, system, idea, { debug: DEBUG });
      prompts.push((out || "").trim());
    }
    const summary = ideas[0].slice(0, 60);
    const info = db.prepare(
      "INSERT INTO scenarios (project_id, topic, style, episodes, seconds, result) VALUES (?, ?, 'idea', ?, ?, ?)"
    ).run(project.id, summary, prompts.length, secs, JSON.stringify(prompts));
    log(req.user.id, "generate_scenario", `${prompts.length} prompt @ project ${project.id}`);
    res.json(db.prepare("SELECT * FROM scenarios WHERE id=?").get(info.lastInsertRowid));
  } catch (e) {
    log(req.user.id, "generate_scenario_error", e.message);
    res.status(502).json({ error: `Lỗi gọi API model: ${e.message}` });
  }
});

// ---- Video effect list for the "Tạo Prompt" dropdown ----
app.get("/api/video-effects", authRequired, (req, res) => res.json(listEffects()));

// ---- Generate N continuous prompts (mỗi prompt = 1 video `seconds`s) ----
// Body: { context, count, seconds?, effectId?, continuity? }
app.post("/api/generate-prompts", authRequired, async (req, res) => {
  const { context, count, seconds, effectId, continuity } = req.body || {};
  const ctx = String(context || "").trim();
  const n = parseInt(count, 10);
  const secs = parseInt(seconds, 10) || 8;
  const cont = continuity !== false; // default on
  if (!ctx) return res.status(400).json({ error: "Vui lòng nhập bối cảnh để tạo prompt." });
  if (!n || n < 1) return res.status(400).json({ error: "Số lượng prompt phải lớn hơn hoặc bằng 1." });

  const s = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='settings'").get().value);
  const provider = s.promptModel;
  const cfg = s.providers?.[provider];
  if (!cfg?.enabled) return res.status(400).json({ error: `Model "${provider}" chưa được bật trong Cấu hình API` });

  const eff = effectId || DEFAULT_EFFECT;
  const effects = listEffects();
  const effLabel = effects.find((e) => e.id === eff)?.label || eff;
  if (DEBUG && !effects.some((e) => e.id === eff))
    console.warn(`[generate-prompts] effectId "${eff}" không tồn tại, dùng mặc định`);

  const baseSystem = buildPromptSeriesSystem(n, secs, cont);
  const effectSystem = getVideoEffectSystemPrompt(eff); // PART 6: inject effect system prompt
  const user = buildPromptSeriesUser(ctx, n, secs, effLabel, cont);

  try {
    const raw = await generate(provider, cfg, baseSystem, user, { debug: DEBUG, extraSystem: effectSystem });
    const prompts = splitPrompts(raw, n).map((promptText, i) => ({
      id: `p${Date.now()}_${i + 1}`, index: i + 1, duration: secs, effectId: eff, promptText,
      continuityNote: cont ? (i === 0 ? "Mở đầu" : `Tiếp nối cảnh ${i}`) : "",
    }));
    log(req.user.id, "generate_prompts", `${prompts.length}/${n} prompt @ ${eff}`);
    res.json({ effectId: eff, count: prompts.length, prompts });
  } catch (e) {
    log(req.user.id, "generate_prompts_error", e.message);
    res.status(502).json({ error: `Lỗi gọi API model: ${e.message}` });
  }
});

// Cập nhật nội dung prompt đã chỉnh sửa (lưu vào lịch sử dự án).
app.put("/api/scenarios/:id", authRequired, (req, res) => {
  const sc = db.prepare("SELECT * FROM scenarios WHERE id=?").get(req.params.id);
  if (!sc || !ownedProject(req.user, sc.project_id)) return res.status(403).json({ error: "Không có quyền" });
  const { result } = req.body || {};
  if (!Array.isArray(result)) return res.status(400).json({ error: "result phải là mảng prompt" });
  db.prepare("UPDATE scenarios SET result=? WHERE id=?").run(JSON.stringify(result.map(String)), sc.id);
  log(req.user.id, "update_scenario", `scenario ${sc.id}`);
  res.json(db.prepare("SELECT * FROM scenarios WHERE id=?").get(sc.id));
});

// ---- Video jobs: build queue from prompts + run against MaxCheapAI ----
// Body: { projectId, prompts: [{ id, promptText, videoCount }], overrides?: {...model options} }
app.post("/api/video-jobs", authRequired, async (req, res) => {
  const { prompts, overrides, projectId, batchName } = req.body || {};
  if (!Array.isArray(prompts) || prompts.length === 0)
    return res.status(400).json({ error: "Thiếu danh sách prompt" });

  // Video luôn gắn 1 dự án video để lưu trữ/xem lại theo dự án.
  if (!projectId || !ownedVideoProject(req.user, projectId))
    return res.status(400).json({ error: "Thiếu dự án video hợp lệ" });

  const { provider, cfg, videoApi } = cfgSvc.getVideoApiConfig();
  if (!cfg?.apiKey) return res.status(400).json({ error: "Thiếu API key cho video provider trong Cấu hình API" });

  // Toàn bộ setting gửi từ tab Tạo video (overrides) là nguồn chính; chỉ dùng
  // config đã lưu để lấp field client không gửi (undefined). Giá trị rỗng "" bị coi
  // như thiếu để không đẩy payload lỗi xuống provider.
  const pick = (a, b) => (a === undefined || a === "" || a === null ? b : a);
  const o = overrides || {};
  const modelId = pick(o.modelId, cfg.modelId);
  const basePayload = {
    modelId,
    resolution: pick(o.resolution, cfg.resolution),
    duration: pick(o.duration, cfg.duration),
    speed: pick(o.speed, cfg.speed),
    aspectRatio: pick(o.aspectRatio, cfg.aspectRatio),
    generateAudio: o.generateAudio ?? cfg.generateAudio ?? false, // boolean: giữ false hợp lệ
  };
  // startFrame/endFrame giờ theo TỪNG prompt (mỗi hàng có ảnh riêng), không phải override chung.

  const concurrency = Math.min(4, Math.max(1, parseInt(o.concurrency, 10) || videoApi.concurrency || 2));

  // Validate mọi prompt (kèm frame của nó) up front (fail fast, save HP).
  for (const p of prompts) {
    const test = { ...basePayload, prompt: p.promptText };
    if (p.startFrame?.url) test.startFrame = p.startFrame;
    if (p.endFrame?.url) test.endFrame = p.endFrame;
    const v = validateVideoPayload(provider, modelId, test);
    if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  }

  // Nhớ lựa chọn: lưu lại config video (các ô ở tab Tạo video) để lần sau khởi tạo đúng.
  if (overrides) {
    const merged = cfgSvc.mergeSettings({ videoApi: { concurrency,
      providers: { maxcheapai: {
        modelId, resolution: basePayload.resolution, duration: basePayload.duration,
        speed: basePayload.speed, aspectRatio: basePayload.aspectRatio, generateAudio: basePayload.generateAudio,
      } } } });
    cfgSvc.saveSettings(merged);
  }

  const batchId = crypto.randomUUID();
  const jobs = queue.buildJobsFromPrompts(req.user.id, batchId, prompts, provider, modelId, basePayload, projectId, String(batchName || "").trim());
  queue.startBatch({ userId: req.user.id, batchId, cfg, jobs, concurrency });
  log(req.user.id, "video_batch_start", `${jobs.length} jobs @ ${provider}/${modelId} (project ${projectId})`);
  res.json({ batchId, total: jobs.length });
});

// Poll batch progress. Never returns keys.
app.get("/api/video-jobs/:batchId", authRequired, (req, res) => {
  const jobs = queue.getBatchJobs(req.params.batchId).map((j) => {
    let p = {}; try { p = JSON.parse(j.payload || "{}"); } catch {}
    return {
      id: j.id, promptId: j.prompt_id, attemptIndex: j.attempt_index, status: j.status,
      requestId: j.request_id, resultVideoUrl: j.result_url, thumbnailUrl: j.thumbnail_url,
      errorMessage: j.error_message, updatedAt: j.updated_at, createdAt: j.created_at,
      modelId: j.model_id, resolution: p.resolution, aspectRatio: p.aspectRatio, speed: p.speed, duration: p.duration,
    };
  });
  const count = (s) => jobs.filter((j) => j.status === s).length;
  res.json({ batchId: req.params.batchId, total: jobs.length, jobs,
    success: count("success"), failed: count("failed"),
    processing: jobs.filter((j) => ["submitting", "processing", "queued"].includes(j.status)).length });
});

// Upload 1 ảnh (đầu/cuối) -> MaxCheapAI, trả { url }. Client gửi base64 (dataUrl) để
// tránh thêm multer; ảnh nhỏ nên JSON đủ. URL này dùng làm startFrame/endFrame.
app.post("/api/upload/image", authRequired, async (req, res) => {
  const { dataUrl, filename } = req.body || {};
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return res.status(400).json({ error: "Ảnh không hợp lệ (cần dataUrl base64)" });
  const { provider, cfg } = cfgSvc.getVideoApiConfig();
  if (provider !== "maxcheapai") return res.status(400).json({ error: "Chỉ hỗ trợ upload ảnh cho MaxCheapAI" });
  if (!cfg?.apiKey) return res.status(400).json({ error: "Thiếu API key MaxCheapAI" });
  try {
    const buf = Buffer.from(m[2], "base64");
    const r = await maxcheapai.uploadImage(cfg, buf, filename || "frame.png", m[1]);
    res.json({ url: r.imageUrl, width: r.width, height: r.height });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/video-jobs/:batchId/pause", authRequired, (req, res) => { queue.pauseBatch(req.params.batchId); res.json({ ok: true }); });
app.post("/api/video-jobs/:batchId/resume", authRequired, (req, res) => { queue.resumeBatch(req.params.batchId); res.json({ ok: true }); });
app.post("/api/video-jobs/:batchId/cancel", authRequired, (req, res) => { queue.cancelBatch(req.params.batchId); res.json({ ok: true }); });

// Tải các video đã chọn về một thư mục trên máy chạy server (cùng máy desktop).
// Body: { dir, items: [{ url, name? }] }. Trả kết quả từng file.
app.post("/api/download-videos", authRequired, async (req, res) => {
  const fs = require("fs");
  const fsp = fs.promises;
  const path = require("path");
  const { pipeline } = require("stream/promises");
  const { Readable } = require("stream");

  const { dir, items } = req.body || {};
  if (!dir || !String(dir).trim()) return res.status(400).json({ error: "Thiếu thư mục tải về" });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Chưa chọn video nào" });

  try { await fsp.mkdir(dir, { recursive: true }); }
  catch (e) { return res.status(400).json({ error: `Không tạo/mở được thư mục: ${e.message}` }); }

  // Tên file an toàn: bỏ ký tự cấm, chặn path traversal.
  const safeName = (name, i) => {
    const base = String(name || `video_${i + 1}.mp4`).replace(/[\\/:*?"<>|]+/g, "_").replace(/^\.+/, "");
    return base.toLowerCase().endsWith(".mp4") ? base : `${base}.mp4`;
  };

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const file = path.join(dir, safeName(it.name, i));
    try {
      if (!/^https?:\/\//i.test(it.url || "")) throw new Error("URL không hợp lệ");
      const r = await fetch(it.url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file));
      results.push({ url: it.url, ok: true, file });
    } catch (e) {
      results.push({ url: it.url, ok: false, error: e.message });
    }
  }
  const okCount = results.filter((x) => x.ok).length;
  log(req.user.id, "download_videos", `${okCount}/${items.length} -> ${dir}`);
  res.json({ dir, total: items.length, success: okCount, results });
});

// ---- Logs ----
app.get("/api/logs", authRequired, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 500`).all()
    : db.prepare(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.user_id=? ORDER BY l.id DESC LIMIT 500`).all(req.user.id);
  res.json(rows);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server chạy tại http://localhost:${PORT}`));
