const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaVolume", {
  getState: () => ipcRenderer.invoke("volume-menu:get-state"),
  action: (payload) => ipcRenderer.invoke("volume-menu:action", payload),
  openHelp: () => ipcRenderer.invoke("help:open", "audio-studio"),
  close: () => ipcRenderer.invoke("volume-menu:close"),
  onState: (callback) => {
    ipcRenderer.on("volume-menu:state", (_event, state) => callback(state));
  }
});
