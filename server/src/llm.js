// modelPromptService: unified LLM caller.
// Takes a provider config { apiKey, model, baseUrl? } and a prompt, returns the
// text completion. Supports OpenRouter/9router (OpenAI-compatible), Gemini,
// ChatGPT (OpenAI), Claude.
//
// SECURITY: apiKey never logged in full; debug logs mask it and only report
// whether the Authorization header is present.

const { normalizeBaseUrl, joinUrl, maskKey } = require("./util");

// Default OpenAI-compatible base URLs. 9router/openrouter use the user-supplied
// baseUrl when present (that was the missing piece causing "Missing Authentication
// header": the configured endpoint was ignored, so requests hit the wrong host).
const DEFAULT_BASE = {
  openrouter: "https://openrouter.ai/api/v1",
  chatgpt: "https://api.openai.com/v1",
};

function debugLog(enabled, info) {
  if (!enabled) return;
  console.log("[modelPrompt:debug]", JSON.stringify(info));
}

async function callOpenAICompatible(baseUrl, cfg, system, user, { debug, provider } = {}) {
  const url = joinUrl(baseUrl, "chat/completions");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  debugLog(debug, {
    provider,
    baseUrl: normalizeBaseUrl(baseUrl),
    finalUrl: url,
    hasAuthHeader: !!headers.Authorization && !!cfg.apiKey,
    apiKey: maskKey(cfg.apiKey),
    modelId: cfg.model,
  });

  // Optional second system message (e.g. effect-specific instruction).
  const messages = [{ role: "system", content: system }];
  if (arguments[4]?.extraSystem) messages.push({ role: "system", content: arguments[4].extraSystem });
  messages.push({ role: "user", content: user });
  const body = { model: cfg.model, messages };
  if (cfg.temperature != null) body.temperature = cfg.temperature;
  if (cfg.maxTokens != null) body.max_tokens = cfg.maxTokens;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data.error?.message || data.error || `HTTP ${res.status}`;
    if (res.status === 401 || /missing authentication|authorization/i.test(String(raw))) {
      throw new Error("API không nhận được Authorization header. Kiểm tra API key, endpoint và service gửi request.");
    }
    throw new Error(String(raw));
  }
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(cfg, system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

async function callClaude(cfg, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens || 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.content?.map((c) => c.text).join("") || "";
}

// Resolve the OpenAI-compatible base URL for a provider. 9router/openrouter
// require an endpoint; block early with a clear message if it's missing.
function resolveOpenAIBase(provider, cfg) {
  const configured = normalizeBaseUrl(cfg.baseUrl);
  if (provider === "openrouter") {
    if (!configured) throw new Error("Thiếu endpoint cho 9router");
    return configured;
  }
  return configured || DEFAULT_BASE[provider];
}

// Guard: called for every provider before any network request.
function assertConfigured(provider, cfg) {
  if (!cfg) throw new Error(`Provider "${provider}" chưa cấu hình`);
  if (!cfg.apiKey) {
    throw new Error(provider === "openrouter"
      ? "Thiếu API key cho 9router"
      : `Provider "${provider}" chưa cấu hình API key`);
  }
}

// provider: 'openrouter'(9router) | 'gemini' | 'chatgpt' | 'claude'
async function generate(provider, cfg, system, user, opts = {}) {
  assertConfigured(provider, cfg);
  switch (provider) {
    case "openrouter": // 9router: OpenAI-compatible against the configured base URL
    case "chatgpt":
      return callOpenAICompatible(resolveOpenAIBase(provider, cfg), cfg, system, user, { ...opts, provider });
    case "gemini": // no multi-system role: fold effect prompt into the system text
      return callGemini(cfg, opts.extraSystem ? `${system}\n\n${opts.extraSystem}` : system, user);
    case "claude":
      return callClaude(cfg, opts.extraSystem ? `${system}\n\n${opts.extraSystem}` : system, user);
    default:
      throw new Error(`Provider không hỗ trợ: ${provider}`);
  }
}

// Light connectivity test. Returns { ok, status, message, endpoint } — never the key.
async function testConnection(provider, cfg, { debug } = {}) {
  assertConfigured(provider, cfg);
  try {
    if (provider === "openrouter" || provider === "chatgpt") {
      const base = resolveOpenAIBase(provider, cfg);
      const url = joinUrl(base, "chat/completions");
      debugLog(debug, { provider, baseUrl: normalizeBaseUrl(base), finalUrl: url,
        hasAuthHeader: !!cfg.apiKey, apiKey: maskKey(cfg.apiKey), modelId: cfg.model });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      const message = res.ok ? "OK" : (data.error?.message || data.error || `HTTP ${res.status}`);
      return { ok: res.ok, status: res.status, message: String(message), endpoint: url };
    }
    // For non-OpenAI providers, do a minimal generate.
    await generate(provider, cfg, "ping", "ping", { debug });
    return { ok: true, status: 200, message: "OK", endpoint: provider };
  } catch (e) {
    return { ok: false, status: 0, message: e.message, endpoint: provider };
  }
}

// Liệt kê model id mà key hỗ trợ. OpenAI-compatible + Gemini có endpoint list;
// Claude không có API list model công khai -> trả []. Không bao giờ trả key.
async function listModels(provider, cfg) {
  assertConfigured(provider, cfg);
  if (provider === "openrouter" || provider === "chatgpt") {
    const url = joinUrl(resolveOpenAIBase(provider, cfg), "models");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
    return (data.data || []).map((m) => m.id).filter(Boolean).sort();
  }
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${cfg.apiKey}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, "")).filter(Boolean).sort();
  }
  return []; // claude: không có endpoint list
}

// Test kết nối + lấy danh sách model trong một lần gọi. models=[] nếu provider
// không hỗ trợ list hoặc lấy list lỗi (không làm test fail vì lý do đó).
async function testAndListModels(provider, cfg, opts = {}) {
  const result = await testConnection(provider, cfg, opts);
  if (!result.ok) return { ...result, models: [] };
  try { return { ...result, models: await listModels(provider, cfg) }; }
  catch { return { ...result, models: [] }; }
}

module.exports = { generate, testConnection, listModels, testAndListModels };
