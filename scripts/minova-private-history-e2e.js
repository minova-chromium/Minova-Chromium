const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10102);
const reportPath = path.join(__dirname, "artifacts", `private-history-${port}.json`);
const screenshotPath = path.join(__dirname, "artifacts", `private-tab-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(target, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result.result.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // Electron's debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Expected debugging target was not found");
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  await evaluate(shell, `(() => {
    state.history = [{ url: "https://history.test/", title: "History seed", visitedAt: Date.now() }];
    state.searchHistory = [{ query: "history seed", searchedAt: Date.now() }];
    persistHistory();
    localStorage.setItem("minova:search-history", JSON.stringify(state.searchHistory));
    document.querySelector("#mainMenuButton").click();
    return true;
  })()`);

  const menu = await findTarget((target) => target.url.includes("/src/quick-menu.html"));
  await sleep(300);
  report.privateMenuLabel = await evaluate(menu, `document.querySelector('[data-action="new-private-tab"]')?.textContent.trim()`);
  assert(report.privateMenuLabel?.startsWith("New private tab"), "The private-tab command is missing from the menu");
  await evaluate(menu, `document.querySelector('[data-action="new-private-tab"]').click(); true`);
  await sleep(350);

  report.privateTab = await evaluate(shell, `(async () => {
    const tab = getActiveTab();
    return {
      id: tab?.id,
      private: tab?.private,
      title: document.querySelector('[data-tab-id="' + tab?.id + '"] .tab-title')?.textContent,
      security: document.querySelector("#securityChip").textContent,
      noticeVisible: !document.querySelector("#privateNewTabNotice").classList.contains("hidden"),
      extensionsHidden: document.querySelector("#pinnedExtensions").classList.contains("hidden"),
      session: await window.minova.getBrowserTabPrivacy(tab.id)
    };
  })()`);
  assert(report.privateTab.private, "The new tab was not marked private");
  assert(report.privateTab.session?.private && report.privateTab.session?.inMemory, "The private tab is not using the in-memory Chromium session");
  assert(report.privateTab.security === "Private" && report.privateTab.noticeVisible, "Private browsing is not visible in the UI");
  assert(report.privateTab.extensionsHidden, "Normal extension actions leaked into private mode");

  const screenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;

  await evaluate(shell, `navigateActive("private history check"); true`);
  await sleep(2500);
  report.privateHistory = await evaluate(shell, `({
    history: state.history.map((entry) => entry.url),
    searches: state.searchHistory.map((entry) => entry.query || entry),
    activePrivate: getActiveTab()?.private,
    activeUrl: getActiveTab()?.url
  })`);
  assert(report.privateHistory.activePrivate, "Navigation escaped the private tab");
  assert(report.privateHistory.history.length === 1 && report.privateHistory.history[0] === "https://history.test/", "Private navigation was written to history");
  assert(report.privateHistory.searches.length === 1 && report.privateHistory.searches[0] === "history seed", "Private search text was saved");

  await evaluate(shell, `(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "N", ctrlKey: true, shiftKey: true, bubbles: true }));
    return true;
  })()`);
  await sleep(250);
  report.shortcut = await evaluate(shell, `({ private: getActiveTab()?.private, url: getActiveTab()?.url })`);
  assert(report.shortcut.private && report.shortcut.url === "minova://newtab", "Ctrl+Shift+N did not open a private tab");

  await evaluate(shell, `document.querySelector("#mainMenuButton").click(); true`);
  await sleep(250);
  await evaluate(menu, `(() => {
    document.querySelector('[data-action="history"]').dispatchEvent(new PointerEvent("pointerenter"));
    return true;
  })()`);
  const submenu = await findTarget((target) => target.url.includes("/src/quick-submenu.html"));
  await sleep(300);
  report.clearButton = await evaluate(submenu, `({
    text: document.querySelector("#clearHistoryButton").textContent,
    hidden: document.querySelector("#clearHistoryButton").classList.contains("hidden"),
    disabled: document.querySelector("#clearHistoryButton").disabled
  })`);
  assert(report.clearButton.text === "Delete all history" && !report.clearButton.hidden && !report.clearButton.disabled, "The one-click history delete button is not usable");
  await evaluate(submenu, `document.querySelector("#clearHistoryButton").click(); true`);
  await sleep(250);

  report.cleared = await evaluate(shell, `({
    historyLength: state.history.length,
    searchHistoryLength: state.searchHistory.length,
    storedHistory: JSON.parse(localStorage.getItem("minova:history") || "[]").length,
    storedSearchHistory: localStorage.getItem("minova:search-history")
  })`);
  assert(report.cleared.historyLength === 0 && report.cleared.searchHistoryLength === 0, "History was not cleared from memory");
  assert(report.cleared.storedHistory === 0 && report.cleared.storedSearchHistory === null, "History was not cleared from local storage");

  await evaluate(shell, `navigateActive("minova://history"); true`);
  await sleep(150);
  report.historyPage = await evaluate(shell, `({
    label: document.querySelector("#clearHistoryButton")?.textContent,
    disabled: document.querySelector("#clearHistoryButton")?.disabled
  })`);
  assert(report.historyPage.label === "Delete all history" && report.historyPage.disabled, "The History page does not keep its clear-all button visible");

  await evaluate(shell, `navigateActive("https://example.com/"); true`);
  await sleep(2500);
  report.privateCookieBeforeClose = await evaluate(shell, `(async () => {
    const tab = getActiveTab();
    await window.minova.executeBrowserTab(tab.id, 'document.cookie = "minovaPrivateProbe=present; SameSite=Lax"');
    return window.minova.executeBrowserTab(tab.id, "document.cookie");
  })()`);
  assert(report.privateCookieBeforeClose.includes("minovaPrivateProbe=present"), "The private-session cleanup probe cookie was not created");

  await evaluate(shell, `(() => {
    for (const tab of [...state.tabs].filter((entry) => entry.private)) closeTab(tab.id);
    return state.tabs.some((entry) => entry.private);
  })()`);
  await sleep(800);
  await evaluate(shell, `openTab("https://example.com/", { private: true }); true`);
  await sleep(2500);
  report.privateCookieAfterReopen = await evaluate(shell, `(async () => {
    const tab = getActiveTab();
    return window.minova.executeBrowserTab(tab.id, "document.cookie");
  })()`);
  assert(!report.privateCookieAfterReopen.includes("minovaPrivateProbe"), "Private cookies survived after the last private tab closed");

  report.passed = true;
  report.finishedAt = new Date().toISOString();
  save();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  process.exitCode = 1;
});
