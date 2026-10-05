const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaPopout", {
  togglePin: () => ipcRenderer.invoke("video:toggle-pin"),
  minimize: () => ipcRenderer.invoke("video:minimize"),
  close: () => ipcRenderer.invoke("video:close"),
  onStatus: (callback) => {
    ipcRenderer.on("video:status", (_event, status) => callback(status));
  }
});
