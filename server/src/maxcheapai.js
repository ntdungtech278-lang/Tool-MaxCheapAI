// maxcheapaiService: thin wrapper over the MaxCheapAI video API.
// Base URL default https://maxcheapai.com/api ; auth Bearer <mcai_api_key>.
// SECURITY: key comes from server-side settings only, never logged in full.

const { normalizeBaseUrl, joinUrl, maskKey } = require("./util");

const DEFAULT_BASE = "https://maxcheapai.com/api";
const REQUEST_TIMEOUT_MS = 30000; // hủy request treo sau 30s thay vì chờ vô hạn

// fetch có timeout: tránh treo khi provider không phản hồi. Lỗi timeout mang message rõ ràng.
async function fetchT(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      const err = new Error(`Hết thời gian chờ MaxCheapAI (> ${REQUEST_TIMEOUT_MS / 1000}s)`);
      err.status = 0;
      throw err;
    }
    throw e;
  }
}

// Friendly messages for the documented status codes.
function friendlyError(status, raw) {
  const map = {
    400: "Sai hoặc thiếu field (prompt/modelId/speed/duration/resolution).",
    401: "Thiếu hoặc sai API key MaxCheapAI.",
    402: "Không đủ HP để tạo video.",
    429: "Vượt giới hạn video đồng thời, hãy chờ job cũ xong.",
    500: "Lỗi máy chủ MaxCheapAI.",
  };
  const friendly = map[status] || `HTTP ${status}`;
  return raw ? `${friendly} (${raw})` : friendly;
}

function baseOf(cfg) {
  return normalizeBaseUrl(cfg.baseUrl) || DEFAULT_BASE;
}

function authHeaders(cfg, extra = {}) {
  if (!cfg?.apiKey) throw new Error("Thiếu API key cho MaxCheapAI");
  return { Authorization: `Bearer ${cfg.apiKey}`, ...extra };
}

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data.error?.message || data.error || data.message || "";
    const err = new Error(friendlyError(res.status, raw));
    err.status = res.status;
    err.raw = raw; // surfaced only in debug channel, never logged with key
    throw err;
  }
  return data;
}

// POST /generate/video -> { requestId, hpCost, hpBalance }
async function generateVideo(cfg, payload, { debug } = {}) {
  const url = joinUrl(baseOf(cfg), "generate/video");
  if (debug) console.log("[maxcheapai:debug]", JSON.stringify({
    finalUrl: url, hasAuthHeader: !!cfg.apiKey, apiKey: maskKey(cfg.apiKey), modelId: payload.modelId }));
  const res = await fetchT(url, {
    method: "POST",
    headers: authHeaders(cfg, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parse(res);
}

// GET /hp -> { freeHp, paidHp, totalHp, checkedInToday, streak }. Số dư HP tài khoản.
async function getHpBalance(cfg) {
  const url = joinUrl(baseOf(cfg), "hp");
  const res = await fetchT(url, { headers: authHeaders(cfg) });
  return parse(res);
}

// GET /video-generations/:id -> { status, resultVideoUrl?, thumbnailUrl?, error? }
async function getVideoGeneration(cfg, id) {
  const url = joinUrl(baseOf(cfg), `video-generations/${id}`);
  const res = await fetchT(url, { headers: authHeaders(cfg) });
  return parse(res);
}

// GET /video-generations?limit=...
async function listVideoGenerations(cfg, limit = 20) {
  const url = joinUrl(baseOf(cfg), `video-generations?limit=${encodeURIComponent(limit)}`);
  const res = await fetch(url, { headers: authHeaders(cfg) });
  return parse(res);
}

// POST /upload/image (multipart). buffer + filename.
async function uploadImage(cfg, buffer, filename, mime = "image/png") {
  const url = joinUrl(baseOf(cfg), "upload/image");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const res = await fetch(url, { method: "POST", headers: authHeaders(cfg), body: form });
  return parse(res);
}

// POST /upload/video (multipart).
async function uploadVideo(cfg, buffer, filename, mime = "video/mp4") {
  const url = joinUrl(baseOf(cfg), "upload/video");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const res = await fetch(url, { method: "POST", headers: authHeaders(cfg), body: form });
  return parse(res);
}

module.exports = {
  DEFAULT_BASE, generateVideo, getHpBalance, getVideoGeneration, listVideoGenerations,
  uploadImage, uploadVideo, friendlyError,
};
