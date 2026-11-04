// klingService: wrapper over the official Kling AI video API.
// Auth: Access Key + Secret Key -> short-lived JWT (HS256), signed per request.
// SECURITY: keys come from server-side settings only, never logged in full.
//
// request_id lưu dạng "<kind>:<task_id>" (kind = text2video | image2video) vì Kling
// bắt buộc poll đúng endpoint theo loại task — khỏi thêm cột DB.
// getVideoGeneration trả { status: success|failed|processing, resultVideoUrl, error }.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeBaseUrl, joinUrl, maskKey } = require("./util");
const { KLING_MODELS } = require("./videoValidate");

const DEFAULT_BASE = "https://api-singapore.klingai.com";
const REQUEST_TIMEOUT_MS = 30000;
const UPLOAD_DIR = path.join(process.env.APP_DATA_DIR || path.join(__dirname, ".."), "uploads");
const LOCAL_PREFIX = "/uploads/"; // frame.url trỏ tới file local; đọc & gửi base64 lúc submit

async function fetchT(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      const err = new Error(`Hết thời gian chờ Kling (> ${REQUEST_TIMEOUT_MS / 1000}s)`);
      err.status = 0;
      throw err;
    }
    throw e;
  }
}

// Mã lỗi nghiệp vụ Kling (field `code` trong body). Cần đối chiếu docs bản hiện hành.
const CODE_MSG = {
  1000: "Xác thực thất bại (sai Access Key/Secret Key).",
  1001: "Thiếu thông tin xác thực Kling.",
  1002: "Thông tin xác thực Kling không hợp lệ.",
  1003: "Token Kling chưa có hiệu lực (kiểm tra giờ hệ thống).",
  1004: "Token Kling đã hết hạn.",
  1101: "Tài khoản Kling đang nợ phí.",
  1102: "Không đủ credit / hết gói tài nguyên Kling.",
  1103: "Tài khoản không có quyền dùng model/tính năng này.",
  1200: "Tham số yêu cầu không hợp lệ.",
  1201: "Giá trị tham số không hợp lệ.",
  1301: "Nội dung vi phạm chính sách an toàn của Kling.",
  1302: "Gọi API quá nhanh (giới hạn tần suất).",
  1303: "Vượt giới hạn số video chạy đồng thời của gói Kling.",
  1304: "IP không nằm trong whitelist Kling.",
};
// 1302/1303 coi như 429 -> queueService tự backoff + retry.
const RATE_CODES = new Set([1302, 1303]);

function friendlyError(status, raw, code) {
  const friendly = CODE_MSG[code] || ({
    401: "Sai hoặc thiếu Access Key/Secret Key Kling.",
    429: "Vượt giới hạn gọi/đồng thời của Kling, hãy chờ job cũ xong.",
    500: "Lỗi máy chủ Kling.",
  }[status]) || `HTTP ${status}`;
  return raw ? `${friendly} (${raw})` : friendly;
}

function baseOf(cfg) {
  return normalizeBaseUrl(cfg.baseUrl) || DEFAULT_BASE;
}

const b64u = (s) => Buffer.from(s).toString("base64url");

// JWT HS256: iss = access key, exp = +30 phút, nbf = lùi 5s để chịu lệch đồng hồ.
function signJwt(accessKey, secretKey) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const t = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ iss: accessKey, exp: t + 1800, nbf: t - 5 }));
  const sig = crypto.createHmac("sha256", secretKey).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const CREDS_HINT = "Access Key + Secret Key Kling";
const hasCreds = (cfg) => !!(cfg?.apiKey && cfg?.secretKey);

function authHeaders(cfg, extra = {}) {
  if (!hasCreds(cfg)) throw new Error("Thiếu Access Key hoặc Secret Key cho Kling");
  return { Authorization: `Bearer ${signJwt(cfg.apiKey, cfg.secretKey)}`, ...extra };
}

// Kling trả HTTP 200 kèm { code, message, data }; code !== 0 là lỗi nghiệp vụ.
async function parse(res) {
  const data = await res.json().catch(() => ({}));
  const code = data.code;
  if (!res.ok || (code !== undefined && code !== 0)) {
    const raw = data.message || data.error?.message || "";
    const status = RATE_CODES.has(code) || res.status === 429 ? 429 : (res.status >= 400 ? res.status : 400);
    const err = new Error(friendlyError(status, raw, code));
    err.status = status;
    err.code = code;
    err.raw = raw;
    throw err;
  }
  return data;
}

// Ảnh đầu/cuối -> giá trị field `image`/`image_tail`: URL public giữ nguyên, file local/dataUrl -> base64 trần.
function imageField(url) {
  const u = String(url || "");
  if (u.startsWith(LOCAL_PREFIX)) {
    const file = path.join(UPLOAD_DIR, path.basename(u)); // basename: chặn path traversal
    return fs.readFileSync(file).toString("base64");
  }
  const m = /^data:image\/[\w.+-]+;base64,(.+)$/.exec(u);
  return m ? m[1] : u;
}

// Payload chung của app -> body Kling.
function buildBody(kind, p) {
  const spec = KLING_MODELS[p.modelId] || {};
  const body = {
    model_name: p.modelId,
    prompt: p.prompt,
    mode: String(p.resolution || "std").split("(")[0], // "std(720p)" -> "std"
    duration: String(p.duration),
  };
  if (p.negativePrompt) body.negative_prompt = p.negativePrompt;
  if (p.cfgScale !== undefined && p.cfgScale !== "" && p.cfgScale !== null) body.cfg_scale = Number(p.cfgScale);
  if (spec.generateAudio) body.sound = p.generateAudio ? "on" : "off";
  if (kind === "text2video") {
    body.aspect_ratio = p.aspectRatio; // image2video: tỉ lệ theo ảnh đầu, không có field này
  } else {
    body.image = imageField(p.startFrame.url);
    if (p.endFrame?.url) body.image_tail = imageField(p.endFrame.url);
  }
  return body;
}

// Submit -> { requestId: "<kind>:<task_id>", hpCost: null }. Kling không trả giá từng job.
async function generateVideo(cfg, payload, { debug } = {}) {
  const kind = payload.startFrame?.url ? "image2video" : "text2video";
  const url = joinUrl(baseOf(cfg), `v1/videos/${kind}`);
  if (debug) console.log("[kling:debug]", JSON.stringify({
    finalUrl: url, accessKey: maskKey(cfg.apiKey), hasSecret: !!cfg.secretKey, modelId: payload.modelId, kind }));
  const res = await fetchT(url, {
    method: "POST",
    headers: authHeaders(cfg, { "Content-Type": "application/json" }),
    body: JSON.stringify(buildBody(kind, payload)),
  });
  const data = await parse(res);
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error("Kling không trả task_id");
  return { requestId: `${kind}:${taskId}`, hpCost: null };
}

// Poll -> { status: success|failed|processing, resultVideoUrl, thumbnailUrl, error } (khớp queueService).
async function getVideoGeneration(cfg, requestId) {
  const i = String(requestId).indexOf(":");
  if (i < 0) throw new Error(`request_id Kling không hợp lệ: ${requestId}`);
  const kind = requestId.slice(0, i), id = requestId.slice(i + 1);
  const res = await fetchT(joinUrl(baseOf(cfg), `v1/videos/${kind}/${encodeURIComponent(id)}`),
    { headers: authHeaders(cfg) });
  const d = (await parse(res)).data || {};
  const st = String(d.task_status || "").toLowerCase();
  if (st === "succeed") {
    const v = d.task_result?.videos?.[0];
    return { status: "success", resultVideoUrl: v?.url || "", thumbnailUrl: "" };
  }
  if (st === "failed") return { status: "failed", error: d.task_status_msg || "failed" };
  return { status: "processing" }; // submitted | processing
}

// Test kết nối rẻ, không tốn credit: liệt kê 1 task.
async function listVideoGenerations(cfg, limit = 1) {
  const url = joinUrl(baseOf(cfg), `v1/videos/text2video?pageNum=1&pageSize=${encodeURIComponent(limit)}`);
  return parse(await fetchT(url, { headers: authHeaders(cfg) }));
}

// Kling không có endpoint upload: lưu file local, frame.url = "/uploads/<file>", đọc lại lúc submit.
async function uploadImage(buffer, filename, mime = "image/png") {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" })[mime] || ".png";
  const name = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { imageUrl: `${LOCAL_PREFIX}${name}` };
}

module.exports = {
  DEFAULT_BASE, UPLOAD_DIR, CREDS_HINT, hasCreds, signJwt, generateVideo, getVideoGeneration, listVideoGenerations, uploadImage,
  buildBody, friendlyError,
};

// self-check: run `node src/kling.js`
if (require.main === module) {
  const assert = require("assert");
  const [h, b, s] = signJwt("AK", "SK").split(".");
  assert.equal(JSON.parse(Buffer.from(h, "base64url")).alg, "HS256");
  assert.equal(JSON.parse(Buffer.from(b, "base64url")).iss, "AK");
  assert.equal(s, crypto.createHmac("sha256", "SK").update(`${h}.${b}`).digest("base64url"));
  const t2v = buildBody("text2video", { modelId: "kling-v2-6", prompt: "x", resolution: "pro(1080p)",
    duration: 5, aspectRatio: "16:9", generateAudio: true });
  assert.deepEqual(t2v, { model_name: "kling-v2-6", prompt: "x", mode: "pro", duration: "5",
    sound: "on", aspect_ratio: "16:9" });
  const i2v = buildBody("image2video", { modelId: "kling-v1-6", prompt: "x", resolution: "std(720p)",
    duration: 10, aspectRatio: "16:9", startFrame: { url: "https://h/a.png" }, endFrame: { url: "https://h/b.png" } });
  assert.equal(i2v.image, "https://h/a.png");
  assert.equal(i2v.image_tail, "https://h/b.png");
  assert.ok(!("aspect_ratio" in i2v) && !("sound" in i2v)); // v1-6 không có sound
  console.log("kling.js self-check OK");
}
