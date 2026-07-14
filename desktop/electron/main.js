const { app, BrowserWindow } = require("electron");
const path = require("path");

// Dev mode only when the Vite dev server is expected (launch.js sets this).
// Under plain `electron .` (production/start.bat) we load the built dist.
const isDev = process.env.USE_DEV_SERVER === "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { contextIsolation: true },
  });

  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
