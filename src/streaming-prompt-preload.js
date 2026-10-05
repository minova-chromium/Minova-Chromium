const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaStreamingPrompt", {
  getState: () => ipcRenderer.invoke("streaming-prompt:get-state"),
  enter: () => ipcRenderer.invoke("streaming-prompt:enter"),
  dismiss: () => ipcRenderer.invoke("streaming-prompt:dismiss"),
  onState: (callback) => {
    ipcRenderer.on("streaming-prompt:state", (_event, state) => callback(state));
  }
});
