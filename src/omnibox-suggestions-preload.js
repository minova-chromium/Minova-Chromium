const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaSuggestions", {
  getState: () => ipcRenderer.invoke("omnibox-suggestions:get-state"),
  select: (index) => ipcRenderer.invoke("omnibox-suggestions:select", index),
  onState: (callback) => {
    ipcRenderer.on("omnibox-suggestions:state", (_event, state) => callback(state));
  }
});
