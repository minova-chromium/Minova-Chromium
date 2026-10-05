const { contextBridge, ipcRenderer } = require("electron");

const WINDOW_CONTROL_ACTIONS = Object.freeze({
  minimizeWindowButton: "minimize",
  maximizeWindowButton: "toggle-maximize",
  closeWindowButton: "close"
});

// Keep native window controls independent from the larger renderer. If a
// separate browser feature fails during startup, these capture-phase handlers
// still let the user minimize, restore, or close Minova safely.
window.addEventListener("DOMContentLoaded", () => {
  for (const [buttonId, action] of Object.entries(WINDOW_CONTROL_ACTIONS)) {
    const button = document.getElementById(buttonId);
    if (!button) continue;
    button.dataset.nativeWindowControl = action;
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), true);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      ipcRenderer.send("window:control", action);
    }, true);
  }
}, { once: true });

// The helper augments extension action elements when the dependency is directly
// available to the sandboxed preload. Minova's own extension toolbar uses IPC,
// so a portable staged runtime can continue safely without this optional hook.
try {
  const { injectBrowserAction } = require("electron-chrome-extensions/browser-action");
  injectBrowserAction();
} catch (error) {
  console.warn("Minova extension action helper is unavailable in this runtime:", error.message);
}

contextBridge.exposeInMainWorld("minova", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  resetCustomTheme: () => ipcRenderer.invoke("settings:reset-custom-theme"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  getUpdateState: () => ipcRenderer.invoke("updates:get-state"),
  openFeedback: (type) => ipcRenderer.invoke("feedback:open", type),
  openHelp: (topic) => ipcRenderer.invoke("help:open", topic),
  openWorkspaceEditor: (payload) => ipcRenderer.invoke("workspace:editor-open", payload),
  openFirstRunTour: () => ipcRenderer.invoke("onboarding:open"),
  getAdBlockState: () => ipcRenderer.invoke("privacy:adblock-state"),
  clearBrowsingData: () => ipcRenderer.invoke("browser:clear-data"),
  getVersion: () => ipcRenderer.invoke("browser:get-version"),
  getProtectedContentStatus: (tabId) => ipcRenderer.invoke("browser:protected-content-status", tabId),
  openExternal: (url) => ipcRenderer.invoke("browser:open-external", url),
  openStreamingMode: (tabId, url) => ipcRenderer.invoke("browser:open-streaming-mode", { tabId, url }),
  confirmStreamingLayout: (requestId) => ipcRenderer.send("browser:streaming-layout-ready", { requestId }),
  exitStreamingMode: () => ipcRenderer.invoke("browser:exit-streaming-mode"),
  getStreamingModeState: () => ipcRenderer.invoke("browser:streaming-mode-state"),
  getStreamingPromptStatus: () => ipcRenderer.invoke("browser:streaming-prompt-status"),
  controlStreamingMode: (command) => ipcRenderer.invoke("browser:streaming-mode-command", command),
  showOmniboxSuggestions: (payload) => ipcRenderer.invoke("omnibox-suggestions:show", payload),
  hideOmniboxSuggestions: () => ipcRenderer.invoke("omnibox-suggestions:hide"),
  openPath: (targetPath) => ipcRenderer.invoke("browser:open-path", targetPath),
  openLicense: () => ipcRenderer.invoke("browser:open-license"),
  createBrowserTab: (tabId, options) => ipcRenderer.invoke("browser:tab-create", tabId, options),
  setBrowserWorkspaceLayout: (layout) => ipcRenderer.invoke("browser:workspace-layout", layout),
  getBrowserWorkspaceState: () => ipcRenderer.invoke("browser:workspace-state"),
  getAssistantState: () => ipcRenderer.invoke("assistant:get-state"),
  initializeAssistant: () => ipcRenderer.invoke("assistant:initialize"),
  sendAssistantMessage: (messages) => ipcRenderer.invoke("assistant:chat", messages),
  sendAssistantPageMessage: (messages) => ipcRenderer.invoke("assistant:chat-with-page", messages),
  summarizeActivePage: () => ipcRenderer.invoke("assistant:summarize"),
  runAssistantPageAction: (actionName) => ipcRenderer.invoke("assistant:page-action", actionName),
  copyAssistantText: (text) => ipcRenderer.invoke("assistant:copy-text", text),
  cancelAssistantRequest: (requestId) => ipcRenderer.invoke("assistant:cancel", requestId),
  getBrowserTabPrivacy: (tabId) => ipcRenderer.invoke("browser:tab-privacy", tabId),
  showBrowserTabMenu: (tabId) => ipcRenderer.invoke("browser:tab-menu", tabId),
  getTabPerformanceStatus: () => ipcRenderer.invoke("browser:tab-performance-status"),
  suspendInactiveTabsNow: () => ipcRenderer.invoke("browser:tab-suspend-now"),
  navigateBrowserTab: (tabId, url) => ipcRenderer.invoke("browser:tab-navigate", tabId, url),
  activateBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-activate", tabId),
  closeBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-close", tabId),
  goBackBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-back", tabId),
  goForwardBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-forward", tabId),
  reloadBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-reload", tabId),
  setBrowserTabZoom: (tabId, zoomFactor) => ipcRenderer.invoke("browser:tab-zoom", tabId, zoomFactor),
  executeBrowserTab: (tabId, code) => ipcRenderer.invoke("browser:tab-execute", tabId, code),
  getBrowserTabMediaStatus: (tabId) => ipcRenderer.invoke("browser:tab-media-status", tabId),
  requestBrowserTabPictureInPicture: (tabId) => ipcRenderer.invoke("browser:tab-picture-in-picture", tabId),
  printBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-print", tabId),
  findInBrowserTab: (tabId, query, options) => ipcRenderer.invoke("browser:tab-find", tabId, query, options),
  stopFindInBrowserTab: (tabId) => ipcRenderer.invoke("browser:tab-stop-find", tabId),
  openBrowserTabDevTools: (tabId) => ipcRenderer.invoke("browser:tab-devtools", tabId),
  listPasswords: () => ipcRenderer.invoke("passwords:list"),
  savePassword: (entry) => ipcRenderer.invoke("passwords:save", entry),
  removePassword: (passwordId) => ipcRenderer.invoke("passwords:remove", passwordId),
  migrateLegacyPasswords: (entries) => ipcRenderer.invoke("passwords:migrate-legacy", entries),
  importGooglePasswords: () => ipcRenderer.invoke("passwords:import-google"),
  resyncGooglePasswords: () => ipcRenderer.invoke("passwords:resync-google"),
  exportPasswordsForGoogle: () => ipcRenderer.invoke("passwords:export-google"),
  openVideoPopout: (details) => ipcRenderer.invoke("video:open-popout", details),
  getVideoPopoutStatus: () => ipcRenderer.invoke("video:get-popout-status"),
  listExtensions: () => ipcRenderer.invoke("extensions:list"),
  installWebStoreExtension: (value) => ipcRenderer.invoke("extensions:install-web-store", value),
  loadUnpackedExtension: () => ipcRenderer.invoke("extensions:load-unpacked"),
  removeExtension: (extensionId) => ipcRenderer.invoke("extensions:remove", extensionId),
  openExtensionAction: (extensionId) => ipcRenderer.invoke("extensions:open-action", extensionId),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  toggleFullscreenWindow: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  toggleQuickMenu: (state) => ipcRenderer.invoke("quick-menu:toggle", state),
  toggleVolumeMenu: (anchor) => ipcRenderer.invoke("volume-menu:toggle", anchor),
  positionVolumeMenu: (anchor) => ipcRenderer.invoke("volume-menu:position", anchor),
  getVolumeMenuStatus: () => ipcRenderer.invoke("volume-menu:status"),
  getQuickMenuStatus: () => ipcRenderer.invoke("quick-menu:status"),
  closeQuickMenu: () => ipcRenderer.invoke("quick-menu:close"),
  updateQuickMenuState: (state) => ipcRenderer.invoke("quick-menu:update-state", state),
  onDownloadUpdate: (callback) => {
    ipcRenderer.on("browser:download-update", (_event, download) => callback(download));
  },
  onPasswordsChanged: (callback) => {
    ipcRenderer.on("passwords:changed", (_event, passwords) => callback(passwords));
  },
  onPasswordImportError: (callback) => {
    ipcRenderer.on("passwords:import-error", (_event, message) => callback(message));
  },
  onNewTab: (callback) => {
    ipcRenderer.on("browser:new-tab", (_event, url) => callback(url));
  },
  onBrowserTabState: (callback) => {
    ipcRenderer.on("browser:tab-state", (_event, tabState) => callback(tabState));
  },
  onBrowserShortcut: (callback) => {
    ipcRenderer.on("browser:shortcut", (_event, shortcut) => callback(shortcut));
  },
  onFindResult: (callback) => {
    ipcRenderer.on("browser:find-result", (_event, result) => callback(result));
  },
  onQuickMenuAction: (callback) => {
    ipcRenderer.on("browser:quick-menu-action", (_event, action) => callback(action));
  },
  onAdoptBrowserTab: (callback) => {
    ipcRenderer.on("browser:adopt-tab", (_event, tab) => callback(tab));
  },
  onActivateBrowserTab: (callback) => {
    ipcRenderer.on("browser:activate-tab", (_event, tabId) => callback(tabId));
  },
  onRemoveBrowserTab: (callback) => {
    ipcRenderer.on("browser:remove-tab", (_event, tabId) => callback(tabId));
  },
  onExtensionInstalled: (callback) => {
    ipcRenderer.on("extensions:installed", (_event, extension) => callback(extension));
  },
  onWindowMaximizedChanged: (callback) => {
    ipcRenderer.on("window:maximized-changed", (_event, maximized) => callback(Boolean(maximized)));
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on("settings:changed", (_event, settings) => callback(settings));
  },
  onOmniboxSuggestionSelected: (callback) => {
    ipcRenderer.on("browser:omnibox-suggestion-selected", (_event, index) => callback(index));
  },
  onOmniboxSuggestionsDismissed: (callback) => {
    ipcRenderer.on("browser:omnibox-suggestions-dismissed", () => callback());
  },
  onStreamingModeState: (callback) => {
    ipcRenderer.on("browser:streaming-mode-state", (_event, state) => callback(state));
  },
  onPrepareStreamingLayout: (callback) => {
    ipcRenderer.on("browser:prepare-streaming-layout", (_event, request) => callback(request));
  },
  onAssistantState: (callback) => {
    ipcRenderer.on("assistant:state", (_event, state) => callback(state));
  },
  onAssistantStream: (callback) => {
    ipcRenderer.on("assistant:stream", (_event, chunk) => callback(chunk));
  },
  onAssistantDone: (callback) => {
    ipcRenderer.on("assistant:done", (_event, result) => callback(result));
  },
  onAssistantError: (callback) => {
    ipcRenderer.on("assistant:error", (_event, result) => callback(result));
  }
});
