const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");

// Dev mode only when the Vite dev server is expected (launch.js sets this).
// Under plain `electron .` (production/start.bat) we load the built dist.
const isDev = process.env.USE_DEV_SERVER === "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// Chọn thư mục tải về (native folder picker).
ipcMain.handle("pick-directory", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths?.[0] ? "" : r.filePaths[0];
});

// Mở URL bằng trình duyệt mặc định.
ipcMain.handle("open-external", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
