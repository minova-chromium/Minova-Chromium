const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaSubmenu", {
  action: (payload) => ipcRenderer.invoke("quick-submenu:action", payload),
  getState: () => ipcRenderer.invoke("quick-submenu:get-state"),
  onState: (callback) => {
    ipcRenderer.on("quick-submenu:state", (_event, state) => callback(state));
  }
});
