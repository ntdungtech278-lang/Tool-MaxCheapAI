// kênh giao tiếp với backend
const BASE = "http://localhost:4000/api";

let token = localStorage.getItem("token") || null;
export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
};

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (username, password) => req("POST", "/login", { username, password }),
  me: () => req("GET", "/me"),
  users: () => req("GET", "/users"),
  createUser: (u) => req("POST", "/users", u),
  updateUser: (id, u) => req("PUT", `/users/${id}`, u),
  getSettings: () => req("GET", "/settings"),
  saveSettings: (s) => req("PUT", "/settings", s),
  activeModel: () => req("GET", "/active-model"),
  projects: () => req("GET", "/projects"),
  createProject: (name) => req("POST", "/projects", { name }),
  updateProject: (id, patch) => req("PUT", `/projects/${id}`, patch),
  deleteProject: (id) => req("DELETE", `/projects/${id}`),
  scenarios: (projectId) => req("GET", `/projects/${projectId}/scenarios`),
  generate: (projectId, payload) => req("POST", `/projects/${projectId}/scenarios`, payload),
  updateScenario: (id, result) => req("PUT", `/scenarios/${id}`, { result }),
  logs: () => req("GET", "/logs"),

  // Prompt series (N prompt liên tục, mỗi prompt = 1 video 8s).
  videoEffects: () => req("GET", "/video-effects"),
  generatePrompts: (payload) => req("POST", "/generate-prompts", payload),

  // Test-connection (masked, no key returned).
  testModelPrompt: (provider, cfg) => req("POST", "/model-prompt/test", { provider, cfg }),
  testVideoApi: (provider) => req("POST", "/video-api/test", { provider }),

  // Video queue.
  videoModels: () => req("GET", "/video-models"),
  startVideoJobs: (prompts, overrides) => req("POST", "/video-jobs", { prompts, overrides }),
  videoBatch: (batchId) => req("GET", `/video-jobs/${batchId}`),
  pauseBatch: (batchId) => req("POST", `/video-jobs/${batchId}/pause`),
  resumeBatch: (batchId) => req("POST", `/video-jobs/${batchId}/resume`),
  cancelBatch: (batchId) => req("POST", `/video-jobs/${batchId}/cancel`),
  downloadVideos: (dir, items) => req("POST", "/download-videos", { dir, items }),
};
