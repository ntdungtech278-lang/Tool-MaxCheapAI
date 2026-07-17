// configService: read/save the single settings row and hand out masked views.
// Renderer never receives raw keys — only maskKey() previews + hasKey booleans.

const db = require("./db");
const { maskKey } = require("./util");

function getSettings() {
  return JSON.parse(db.prepare("SELECT value FROM settings WHERE key='settings'").get().value);
}

function saveSettings(next) {
  db.prepare("UPDATE settings SET value=? WHERE key='settings'").run(JSON.stringify(next));
}

function getModelPromptConfig(provider) {
  const s = getSettings();
  const p = provider || s.promptModel;
  return { provider: p, cfg: s.providers?.[p], settings: s };
}

function getVideoApiConfig(provider) {
  const s = getSettings();
  const va = s.videoApi || {};
  const p = provider || va.activeProvider;
  return { provider: p, cfg: va.providers?.[p], videoApi: va };
}

// Merge an incoming settings object from the client WITHOUT letting masked/blank
// key placeholders wipe stored secrets. If the client sends an empty apiKey, keep
// the existing one; only overwrite when a real new value is provided.
const stripMask = ({ apiKeyMask, hasKey, ...rest }) => rest; // drop client-only fields

function mergeSettings(incoming) {
  const cur = getSettings();
  const out = { ...cur, ...incoming };

  // providers
  out.providers = { ...cur.providers };
  for (const [key, raw] of Object.entries(incoming.providers || {})) {
    const val = stripMask(raw);
    const prev = cur.providers?.[key] || {};
    const apiKey = val.apiKey ? val.apiKey : prev.apiKey; // blank = keep
    out.providers[key] = { ...prev, ...val, apiKey };
  }

  // veo3
  if (incoming.veo3) {
    const prev = cur.veo3 || {};
    const v = stripMask(incoming.veo3);
    out.veo3 = { ...prev, ...v, geminiApiKey: v.geminiApiKey || prev.geminiApiKey };
  }

  // videoApi
  if (incoming.videoApi) {
    const prevVa = cur.videoApi || { providers: {} };
    out.videoApi = { ...prevVa, ...incoming.videoApi, providers: { ...prevVa.providers } };
    for (const [key, raw] of Object.entries(incoming.videoApi.providers || {})) {
      const val = stripMask(raw);
      const prev = prevVa.providers?.[key] || {};
      out.videoApi.providers[key] = { ...prev, ...val, apiKey: val.apiKey ? val.apiKey : prev.apiKey };
    }
  }

  // sheetApi: { saJson (chuỗi JSON service account), emails: [] }.
  // saJson rỗng từ client = giữ cái đã lưu (không xóa key).
  if (incoming.sheetApi) {
    const prev = cur.sheetApi || {};
    // Bỏ field chỉ để hiển thị. clientSecret/refreshToken rỗng từ client = giữ cái đã lưu.
    const { hasSecret, connected, connectedEmail, ...v } = incoming.sheetApi;
    out.sheetApi = {
      ...prev, ...v,
      clientSecret: v.clientSecret ? v.clientSecret : prev.clientSecret,
      refreshToken: prev.refreshToken, // token chỉ đổi qua flow OAuth, không qua form
    };
  }
  return out;
}

// Redact every key before shipping settings to the renderer.
function toClientSafe(s) {
  const clone = JSON.parse(JSON.stringify(s));
  for (const p of Object.values(clone.providers || {})) {
    p.apiKeyMask = maskKey(p.apiKey); p.hasKey = !!p.apiKey; p.apiKey = "";
  }
  if (clone.veo3) {
    clone.veo3.apiKeyMask = maskKey(clone.veo3.geminiApiKey);
    clone.veo3.hasKey = !!clone.veo3.geminiApiKey; clone.veo3.geminiApiKey = "";
  }
  for (const p of Object.values(clone.videoApi?.providers || {})) {
    p.apiKeyMask = maskKey(p.apiKey); p.hasKey = !!p.apiKey; p.apiKey = "";
  }
  // sheetApi (OAuth): không trả secret/refreshToken ra client; chỉ báo trạng thái.
  if (clone.sheetApi) {
    const sa = clone.sheetApi;
    clone.sheetApi = {
      clientId: sa.clientId || "",
      hasSecret: !!sa.clientSecret,
      connected: !!sa.refreshToken,          // đã kết nối Google chưa
      connectedEmail: sa.connectedEmail || "",
      folderId: sa.folderId || "",
    };
  }
  return clone;
}

// Cấu hình xuất Sheet (OAuth). Chỉ dùng server-side.
function getSheetConfig() {
  const s = getSettings();
  const sa = s.sheetApi || {};
  return {
    clientId: sa.clientId || "", clientSecret: sa.clientSecret || "",
    refreshToken: sa.refreshToken || "", folderId: sa.folderId || "",
    connectedEmail: sa.connectedEmail || "",
  };
}

// Lưu refresh token + email sau khi OAuth thành công (không đụng các field khác).
function saveSheetTokens({ refreshToken, connectedEmail }) {
  const s = getSettings();
  s.sheetApi = { ...(s.sheetApi || {}), refreshToken, connectedEmail: connectedEmail || "" };
  saveSettings(s);
}

// ---- Bảng giá HP tự học ----
// Provider trả hpCost thực mỗi lần tạo. Ta lưu theo combo (model+setting) để lần sau
// ước tính TRƯỚC khi bấm. Học 1 lần/combo là đủ (giá cố định theo combo).
// key = "model|resolution|duration|speed|audio". audio chuẩn hoá về "1"/"0".
function hpPriceKey({ modelId, resolution, duration, speed, generateAudio }) {
  return [modelId, resolution, duration, speed, generateAudio ? 1 : 0].join("|");
}

function getHpPrices() {
  return getSettings().hpPrices || {};
}

// Ghi giá học được cho 1 combo (chỉ ghi khi chưa có, tránh update thừa mỗi job).
function learnHpPrice(combo, hpCost) {
  const cost = Number(hpCost);
  if (!Number.isFinite(cost) || cost <= 0) return;
  const s = getSettings();
  const prices = s.hpPrices || {};
  const key = hpPriceKey(combo);
  if (prices[key] === cost) return; // đã đúng, khỏi ghi
  prices[key] = cost;
  s.hpPrices = prices;
  saveSettings(s);
}

module.exports = {
  getSettings, saveSettings, mergeSettings, toClientSafe,
  getModelPromptConfig, getVideoApiConfig, getSheetConfig, saveSheetTokens,
  hpPriceKey, getHpPrices, learnHpPrice,
};
