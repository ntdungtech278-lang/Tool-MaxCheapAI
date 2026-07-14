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
  return clone;
}

module.exports = {
  getSettings, saveSettings, mergeSettings, toClientSafe,
  getModelPromptConfig, getVideoApiConfig,
};
