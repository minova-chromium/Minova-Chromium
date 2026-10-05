chrome.storage.local.set({ backgroundReady: true });
chrome.action.setBadgeBackgroundColor({ color: "#0aa39a" });
chrome.action.setBadgeText({ text: "OK" });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "minova-test-context-menu",
      title: "Minova extension test",
      contexts: ["page"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "minova-test-context-menu") {
    chrome.storage.local.set({ contextMenuClicked: true });
  }
});
