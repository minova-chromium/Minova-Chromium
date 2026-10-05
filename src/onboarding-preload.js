const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaTour", {
  getState: () => ipcRenderer.invoke("onboarding:get-state"),
  chooseLayout: (layout) => ipcRenderer.invoke("onboarding:choose-layout", layout),
  finish: (action) => ipcRenderer.invoke("onboarding:finish", action)
});
