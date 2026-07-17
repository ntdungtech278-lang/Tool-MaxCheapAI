const { contextBridge, ipcRenderer } = require("electron");

// Cầu an toàn: renderer chỉ gọi được các hàm được expose (contextIsolation).
contextBridge.exposeInMainWorld("desktop", {
  // Mở hộp thoại chọn thư mục; trả path đã chọn hoặc "" nếu hủy.
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  // Mở URL bằng trình duyệt hệ thống (vd link Google Sheet).
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
