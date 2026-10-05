const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaUpdate", {
  choose: (action) => ipcRenderer.send("update-prompt:action", String(action || "")),
  onDetails: (callback) => {
    ipcRenderer.on("update-prompt:details", (_event, details) => callback(details));
  },
  onInstalling: (callback) => {
    ipcRenderer.on("update-prompt:installing", () => callback());
  }
});
