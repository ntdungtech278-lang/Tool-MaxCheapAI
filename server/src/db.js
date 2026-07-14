const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const db = new Database(path.join(__dirname, "..", "data.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL DEFAULT '',
    employee_code TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    active        INTEGER NOT NULL DEFAULT 1,      -- 1 active | 0 disabled
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Third-party API config. One row keyed by 'settings'.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One scenario = one generation run inside a project.
  CREATE TABLE IF NOT EXISTS scenarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    topic      TEXT NOT NULL,
    style      TEXT NOT NULL,            -- 'live_action' | 'typography' | 'vfx'
    episodes   INTEGER NOT NULL,
    result     TEXT NOT NULL,            -- JSON array of episode prompt strings
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per video job (one attempt of one prompt). The queue runner
  -- persists state here so progress survives restarts.
  CREATE TABLE IF NOT EXISTS video_jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    batch_id       TEXT NOT NULL,           -- groups jobs submitted together
    prompt_id      TEXT NOT NULL,           -- client prompt item id
    prompt_text    TEXT NOT NULL,
    attempt_index  INTEGER NOT NULL,        -- 1..videoCount within a prompt
    provider       TEXT NOT NULL,
    model_id       TEXT NOT NULL DEFAULT '',
    request_id     TEXT NOT NULL DEFAULT '',-- provider requestId
    status         TEXT NOT NULL DEFAULT 'queued',
    result_url     TEXT NOT NULL DEFAULT '',
    thumbnail_url  TEXT NOT NULL DEFAULT '',
    error_message  TEXT NOT NULL DEFAULT '',
    retries        INTEGER NOT NULL DEFAULT 0,
    payload        TEXT NOT NULL DEFAULT '{}', -- request body (no key)
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate: thêm cột seconds cho scenarios (thời lượng video, giây).
if (!db.prepare("PRAGMA table_info(scenarios)").all().some((c) => c.name === "seconds")) {
  db.exec("ALTER TABLE scenarios ADD COLUMN seconds INTEGER NOT NULL DEFAULT 8");
}

// Migrate: cấu hình định hướng prompt đầu ra, lưu theo dự án.
if (!db.prepare("PRAGMA table_info(projects)").all().some((c) => c.name === "output_config")) {
  db.exec("ALTER TABLE projects ADD COLUMN output_config TEXT NOT NULL DEFAULT ''");
}

// Seed default admin once.
const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get();
if (!hasAdmin) {
  db.prepare(
    `INSERT INTO users (username, password_hash, full_name, employee_code, role, active)
     VALUES (?, ?, ?, ?, 'admin', 1)`
  ).run("admin", bcrypt.hashSync("admin123", 10), "Administrator", "ADMIN");
}

// Default settings row.
const settingsRow = db.prepare("SELECT value FROM settings WHERE key='settings'").get();
const hasSettings = !!settingsRow;

// Default video API config (added when missing so existing installs keep keys).
const DEFAULT_VIDEO_API = {
  activeProvider: "maxcheapai",
  concurrency: 2,               // MaxCheapAI default video concurrent limit
  providers: {
    maxcheapai: {
      apiKey: "", baseUrl: "https://maxcheapai.com/api",
      modelId: "veo-3.1", speed: "normal", resolution: "720p",
      duration: 8, aspectRatio: "16:9", generateAudio: false,
    },
  },
};

// Migrate older settings: add per-provider `enabled`, `baseUrl` for
// OpenAI-compatible providers, and the `videoApi` block. Non-destructive.
if (settingsRow) {
  const s = JSON.parse(settingsRow.value);
  let changed = false;
  for (const key of Object.keys(s.providers || {})) {
    if (s.providers[key].enabled === undefined) {
      s.providers[key].enabled = key === s.promptModel;
      changed = true;
    }
    // baseUrl for OpenAI-compatible providers (9router endpoint lived nowhere before).
    if ((key === "openrouter" || key === "chatgpt") && s.providers[key].baseUrl === undefined) {
      s.providers[key].baseUrl = key === "openrouter" ? "" : "https://api.openai.com/v1";
      changed = true;
    }
  }
  if (!s.videoApi) { s.videoApi = DEFAULT_VIDEO_API; changed = true; }
  if (changed) db.prepare("UPDATE settings SET value=? WHERE key='settings'").run(JSON.stringify(s));
}

if (!hasSettings) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?)").run(
    JSON.stringify({
      promptModel: "openrouter",       // active provider for scenario generation
      providers: {
        openrouter: { apiKey: "", model: "openai/gpt-4o", baseUrl: "", enabled: true },
        gemini:     { apiKey: "", model: "gemini-2.0-flash", enabled: false },
        chatgpt:    { apiKey: "", model: "gpt-4o", baseUrl: "https://api.openai.com/v1", enabled: false },
        claude:     { apiKey: "", model: "claude-3-5-sonnet-20241022", enabled: false },
      },
      veo3: { geminiApiKey: "", model: "veo-3.0-generate-preview" },
      videoApi: DEFAULT_VIDEO_API,
    })
  );
}

module.exports = db;
