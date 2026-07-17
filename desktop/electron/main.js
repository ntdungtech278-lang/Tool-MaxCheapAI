const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { fork } = require("child_process");

// Dev: Vite dev server + server chạy tay (npm run dev). Packaged: main tự spawn server + load dist.
const isDev = process.env.USE_DEV_SERVER === "1";
const SERVER_PORT = 4000;

let serverProc = null;
let mainWin = null;

// Thư mục dữ liệu ghi được (userData). DB + secret nằm đây -> cập nhật/cài đè KHÔNG mất data.
function dataDir() {
  const dir = app.getPath("userData");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

// JWT secret bền: sinh 1 lần, lưu userData. Không đổi mỗi lần mở app -> token không mất hiệu lực,
// và không nhúng secret cố định trong mã đóng gói.
function jwtSecret() {
  const f = path.join(dataDir(), "jwt-secret");
  try { return fs.readFileSync(f, "utf8").trim(); } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(f, s, { mode: 0o600 }); } catch {}
  return s;
}

// Spawn server (chỉ khi packaged). server/ nằm trong resources (extraResources).
// Trả Promise resolve khi server báo "server-ready" hoặc port mở.
function startServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(process.resourcesPath, "server", "src", "index.js");
    const env = {
      ...process.env,
      PORT: String(SERVER_PORT),
      APP_DATA_DIR: dataDir(),      // DB ghi vào userData
      JWT_SECRET: jwtSecret(),      // secret bền
      ELECTRON_RUN_AS_NODE: "1",    // fork bằng chính electron.exe nhưng chạy như Node thuần
    };
    // fork dùng execPath = electron.exe (đã bundle Node) -> không cần Node cài sẵn trên máy user.
    serverProc = fork(serverEntry, [], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    serverProc.stdout?.on("data", (d) => console.log("[server]", String(d).trim()));
    serverProc.stderr?.on("data", (d) => console.error("[server]", String(d).trim()));
    serverProc.on("message", (m) => { if (m?.type === "server-ready") resolve(); });
    serverProc.on("error", reject);
    serverProc.on("exit", (code) => { if (code) console.error("[server] exited", code); });
    setTimeout(resolve, 8000); // fallback: đừng treo cửa sổ nếu IPC lỡ mất
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  if (isDev) mainWin.loadURL("http://localhost:5173");
  else mainWin.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// 1 instance duy nhất -> tránh 2 server tranh cùng port 4000.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });

  ipcMain.handle("pick-directory", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return r.canceled || !r.filePaths?.[0] ? "" : r.filePaths[0];
  });
  ipcMain.handle("open-external", async (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  app.whenReady().then(async () => {
    if (!isDev) { try { await startServer(); } catch (e) { console.error("start server fail", e); } }
    createWindow();
  });

  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
  // Đảm bảo kill server khi thoát (không để process nền treo lại).
  app.on("will-quit", () => { if (serverProc && !serverProc.killed) serverProc.kill(); });
  process.on("exit", () => { if (serverProc && !serverProc.killed) serverProc.kill(); });
}
