const HOME_URL = "https://www.google.com/";

function normalizeAddress(value) {
  const input = String(value || "").trim();
  if (!input) return HOME_URL;

  try {
    const parsed = new URL(input);
    if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
  } catch {
    // Continue with domain and search parsing.
  }

  if (/^(?:localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/.*)?$/i.test(input) && !/\s/.test(input)) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function publicTab(tab) {
  return {
    id: tab.id,
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    favIconUrl: tab.favIconUrl || "",
    pinned: Boolean(tab.pinned),
    status: tab.status || "complete",
    title: tab.title || "New tab",
    url: tab.url || ""
  };
}

async function stateForTab(tab) {
  const windowId = tab?.windowId;
  if (!Number.isInteger(windowId)) return { tabs: [], activeTabId: null, maximized: false, bookmarked: false };

  const [tabs, browserWindow] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.windows.get(windowId)
  ]);
  const active = tabs.find((item) => item.active) || tab;
  let bookmarked = false;
  if (/^https?:\/\//i.test(active?.url || "")) {
    bookmarked = (await chrome.bookmarks.search({ url: active.url })).length > 0;
  }

  return {
    tabs: tabs.sort((left, right) => left.index - right.index).map(publicTab),
    activeTabId: active?.id || null,
    maximized: browserWindow.state === "maximized" || browserWindow.state === "fullscreen",
    bookmarked
  };
}

async function broadcastWindowState(windowId) {
  if (!Number.isInteger(windowId)) return;
  const tabs = await chrome.tabs.query({ windowId });
  await Promise.allSettled(tabs.map((tab) => {
    if (!tab.id || !/^https?:\/\//i.test(tab.url || "")) return null;
    return chrome.tabs.sendMessage(tab.id, { type: "minova-state-changed" });
  }).filter(Boolean));
}

async function activeContext(sender) {
  const tab = sender.tab;
  if (!tab?.id || !Number.isInteger(tab.windowId)) throw new Error("This browser tab is no longer available.");
  return tab;
}

async function goBack(tabId) {
  try {
    await chrome.tabs.goBack(tabId);
  } catch {
    // The tab has no previous navigation entry.
  }
}

async function goForward(tabId) {
  try {
    await chrome.tabs.goForward(tabId);
  } catch {
    // The tab has no forward navigation entry.
  }
}

async function handleCommand(command, tab) {
  if (command === "new-tab") {
    await chrome.tabs.create({ windowId: tab.windowId, url: HOME_URL, active: true });
    return;
  }
  if (command === "new-window") {
    await chrome.windows.create({ url: HOME_URL, focused: true });
    return;
  }
  if (command === "new-private-window") {
    await chrome.windows.create({ url: HOME_URL, incognito: true, focused: true });
    return;
  }
  if (command === "downloads") {
    await chrome.tabs.update(tab.id, { url: "edge://downloads/" });
    return;
  }
  if (command === "history") {
    await chrome.tabs.update(tab.id, { url: "edge://history/" });
    return;
  }
  if (command === "extensions") {
    await chrome.tabs.update(tab.id, { url: "edge://extensions/" });
    return;
  }
  if (command === "settings") {
    await chrome.tabs.update(tab.id, { url: "edge://settings/" });
    return;
  }
  if (command === "fullscreen") {
    const current = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, { state: current.state === "fullscreen" ? "maximized" : "fullscreen" });
    return;
  }
  if (command === "close-window") await chrome.windows.remove(tab.windowId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tab = await activeContext(sender);
    const type = String(message?.type || "");

    if (type === "get-state") return stateForTab(tab);
    if (type === "navigate") {
      await chrome.tabs.update(tab.id, { url: normalizeAddress(message.value) });
      return true;
    }
    if (type === "activate-tab") {
      await chrome.tabs.update(Number(message.tabId), { active: true });
      return true;
    }
    if (type === "close-tab") {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      if (tabs.length <= 1) {
        await chrome.tabs.create({ windowId: tab.windowId, url: HOME_URL, active: true });
      }
      await chrome.tabs.remove(Number(message.tabId));
      return true;
    }
    if (type === "new-tab") {
      await chrome.tabs.create({ windowId: tab.windowId, url: HOME_URL, active: true });
      return true;
    }
    if (type === "back") return goBack(tab.id);
    if (type === "forward") return goForward(tab.id);
    if (type === "reload") return chrome.tabs.reload(tab.id);
    if (type === "home") return chrome.tabs.update(tab.id, { url: HOME_URL });
    if (type === "toggle-bookmark") {
      const existing = await chrome.bookmarks.search({ url: tab.url });
      if (existing.length) await Promise.all(existing.map((item) => chrome.bookmarks.remove(item.id)));
      else await chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
      return stateForTab(tab);
    }
    if (type === "suggest") {
      const query = String(message.value || "").trim();
      if (!query) return [];
      const results = await chrome.history.search({ text: query, maxResults: 8, startTime: 0 });
      return results.map((item) => ({ title: item.title || item.url, url: item.url, lastVisitTime: item.lastVisitTime || 0 }));
    }
    if (type === "window-minimize") return chrome.windows.update(tab.windowId, { state: "minimized" });
    if (type === "window-maximize") {
      const current = await chrome.windows.get(tab.windowId);
      return chrome.windows.update(tab.windowId, { state: current.state === "maximized" ? "normal" : "maximized" });
    }
    if (type === "window-close") return chrome.windows.remove(tab.windowId);
    if (type === "command") return handleCommand(String(message.command || ""), tab);
    return null;
  })().then((result) => sendResponse({ ok: true, result })).catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});

for (const event of [chrome.tabs.onActivated, chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved]) {
  event.addListener((...args) => {
    const info = args.find((value) => value && typeof value === "object" && Number.isInteger(value.windowId));
    const tab = args.find((value) => value && typeof value === "object" && Number.isInteger(value.id) && Number.isInteger(value.windowId));
    const windowId = info?.windowId ?? tab?.windowId;
    if (Number.isInteger(windowId)) setTimeout(() => broadcastWindowState(windowId), 30);
  });
}
