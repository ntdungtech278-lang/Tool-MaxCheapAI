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
  hp: () => req("GET", "/hp"),
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

  // Video projects (dự án riêng của module Tạo video).
  videoProjects: () => req("GET", "/video-projects"),
  createVideoProject: (name) => req("POST", "/video-projects", { name }),
  deleteVideoProject: (id) => req("DELETE", `/video-projects/${id}`),
  projectVideoBatches: (id) => req("GET", `/video-projects/${id}/batches`),

  // Video queue.
  videoModels: () => req("GET", "/video-models"),
  startVideoJobs: (prompts, overrides, projectId, batchName, mode) => req("POST", "/video-jobs", { prompts, overrides, projectId, batchName, mode }),
  reviseVideo: (jobId, body) => req("POST", `/video-jobs/${jobId}/revise`, body),
  retryVideo: (jobId) => req("POST", `/video-jobs/${jobId}/retry`),
  deleteVideoJob: (jobId) => req("DELETE", `/video-jobs/${jobId}`),
  videoBatch: (batchId) => req("GET", `/video-jobs/${batchId}`),
  pauseBatch: (batchId) => req("POST", `/video-jobs/${batchId}/pause`),
  resumeBatch: (batchId) => req("POST", `/video-jobs/${batchId}/resume`),
  cancelBatch: (batchId) => req("POST", `/video-jobs/${batchId}/cancel`),
  downloadVideos: (dir, items) => req("POST", "/download-videos", { dir, items }),
  uploadImage: (dataUrl, filename) => req("POST", "/upload/image", { dataUrl, filename }),
  exportSheet: (title, items) => req("POST", "/export-sheet", { title, items }),
  sheetAuthUrl: () => req("GET", "/sheet/auth-url"),
};
