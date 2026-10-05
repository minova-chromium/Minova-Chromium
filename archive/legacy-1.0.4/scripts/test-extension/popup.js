Promise.all([
  chrome.tabs.query({ active: true, currentWindow: true }),
  chrome.storage.local.get(["backgroundReady", "contentScriptReady"])
]).then(([tabs, storage]) => {
  const tab = tabs[0];
  document.querySelector("#activeTab").textContent = tab ? `${tab.title} | ${tab.url}` : "No active tab";
  document.querySelector("#storageState").textContent = JSON.stringify(storage);
});

document.querySelector("#createTab").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://example.org/", active: true });
});
