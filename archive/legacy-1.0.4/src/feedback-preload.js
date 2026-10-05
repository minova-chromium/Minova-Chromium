const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaFeedback", {
  getState: () => ipcRenderer.invoke("feedback:get-state"),
  submit: (payload) => ipcRenderer.invoke("feedback:submit", payload),
  close: () => ipcRenderer.invoke("feedback:close"),
  onState: (callback) => {
    ipcRenderer.on("feedback:state", (_event, state) => callback(state));
  }
});
