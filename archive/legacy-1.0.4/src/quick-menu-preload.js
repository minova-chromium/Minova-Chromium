const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaMenu", {
  action: (action) => ipcRenderer.invoke("quick-menu:action", action),
  showSubmenu: (type) => ipcRenderer.invoke("quick-menu:submenu", type),
  closeSubmenu: () => ipcRenderer.invoke("quick-menu:submenu-close"),
  close: () => ipcRenderer.invoke("quick-menu:close"),
  getState: () => ipcRenderer.invoke("quick-menu:get-state"),
  onState: (callback) => {
    ipcRenderer.on("quick-menu:state", (_event, state) => callback(state));
  }
});
