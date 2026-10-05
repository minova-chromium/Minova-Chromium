const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaWorkspace", {
  getState: () => ipcRenderer.invoke("workspace-editor:get-state"),
  finish: (result) => ipcRenderer.send("workspace-editor:finish", result),
  cancel: () => ipcRenderer.send("workspace-editor:finish", { action: "cancel" })
});
