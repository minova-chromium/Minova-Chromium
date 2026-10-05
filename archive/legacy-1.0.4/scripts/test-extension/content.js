document.documentElement.dataset.minovaExtensionTest = "active";
chrome.storage.local.set({
  contentScriptReady: true,
  contentScriptUrl: location.href
});
