const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10021);
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `features-${port}.json`);
const report = { port, startedAt: new Date().toISOString(), checks: {} };
let shellTarget = null;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(webSocketDebuggerUrl, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const details = message.result?.exceptionDetails;
        reject(new Error(message.error?.message || details?.exception?.description || details?.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMs) {
  const result = await command(target.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result.result.value;
}

async function getTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return response.json();
}

async function findTarget(predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await getTargets()).find(predicate);
      if (target) return target;
    } catch {
      // Electron's debugging endpoint may still be starting a child window.
    }
    await sleep(100);
  }
  throw new Error("Expected debugging target was not found");
}

async function getShell() {
  const shell = (await getTargets()).find((target) => target.url.includes("/src/index.html"));
  if (!shell) throw new Error("Minova shell target was not found");
  return shell;
}

async function restoreTestData(shell) {
  return evaluate(shell, `(() => {
    const backup = window.__minovaE2EBackup;
    if (backup) {
      state.history = backup.history;
      state.searchHistory = backup.searchHistory;
      state.shortcuts = backup.shortcuts;
    }
    state.searchHistory = state.searchHistory.filter((entry) => String(entry.query || entry) !== "minova feature history test");
    state.shortcuts = state.shortcuts.filter((entry) => entry.name !== "Minova Test");
    state.history = state.history.filter((entry) => !(
      entry.url === "https://example.com/"
      && Number(entry.visitedAt) > Date.now() - 60 * 60 * 1000
    ));
    persistHistory();
    localStorage.setItem("minova:search-history", JSON.stringify(state.searchHistory));
    persistShortcuts();
    renderShortcuts();
    delete window.__minovaE2EBackup;
    return Boolean(backup);
  })()`);
}

async function main() {
  save();
  const shell = await getShell();
  shellTarget = shell;
  await restoreTestData(shell);

  await evaluate(shell, `(() => {
    window.__minovaE2EBackup = {
      history: structuredClone(state.history),
      searchHistory: structuredClone(state.searchHistory),
      shortcuts: structuredClone(state.shortcuts)
    };
    return true;
  })()`);

  const startup = await evaluate(shell, `({
    tabCount: state.tabs.length,
    activeUrl: getActiveTab()?.url,
    activeLoading: getActiveTab()?.loading,
    shellBuild: location.search,
    webviews: document.querySelectorAll("webview").length
  })`);
  assert(startup.activeUrl?.startsWith("https://www.google.com"), "Google was not the startup page");
  assert(startup.webviews === 0, "Legacy webview elements are still present");
  report.checks.startup = startup;
  save();

  const suggestion = await evaluate(shell, `(async () => {
    recordSearch("minova feature history test");
    omnibox.value = "mino";
    omnibox.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const popup = await window.minova.getQuickMenuStatus();
    const result = {
      count: visibleSuggestions.length,
      values: visibleSuggestions.map((item) => item.value),
      visible: popup.omniboxSuggestionsVisible,
      pageStillVisible: popup.activeViewVisible && !popup.browserViewsSuppressed,
      bounds: popup.omniboxSuggestionsBounds
    };
    return result;
  })()`);
  assert(suggestion.visible && suggestion.values.includes("minova feature history test"), "History autocomplete did not show a matching search");
  assert(suggestion.pageStillVisible, "Opening autocomplete hid the active webpage");
  const suggestionTarget = await findTarget((target) => target.url.includes("/src/omnibox-suggestions.html"));
  const popupContents = await evaluate(suggestionTarget, `({
    itemCount: document.querySelectorAll(".suggestion").length,
    firstPrimary: document.querySelector(".suggestion strong")?.textContent,
    surfaceColor: getComputedStyle(document.querySelector(".suggestion-surface")).backgroundColor
  })`);
  assert(popupContents.itemCount === suggestion.count && popupContents.firstPrimary === "minova feature history test", "Native autocomplete popup did not render its suggestions");
  const popupScreenshot = await command(suggestionTarget.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" });
  const popupScreenshotPath = path.join(artifacts, `omnibox-suggestions-${port}.png`);
  fs.writeFileSync(popupScreenshotPath, Buffer.from(popupScreenshot.data, "base64"));
  await evaluate(suggestionTarget, `(() => {
    document.querySelector(".suggestion").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const selection = await evaluate(shell, `(async () => ({
    input: omnibox.value,
    activeUrl: getActiveTab()?.url,
    searchQuery: extractSearchQuery(getActiveTab()?.url || ""),
    popupVisible: (await window.minova.getQuickMenuStatus()).omniboxSuggestionsVisible
  }))()`);
  report.checks.historyAutocomplete = { ...suggestion, popupContents, popupScreenshotPath, selection };
  save();
  assert(selection.searchQuery === "minova feature history test" && !selection.popupVisible, "Clicking a native autocomplete item did not navigate and close it");
  save();

  const shortcut = await evaluate(shell, `(() => {
    const tab = openTab("minova://newtab");
    openShortcutDialog();
    document.querySelector("#shortcutName").value = "Minova Test";
    document.querySelector("#shortcutUrl").value = "example.com";
    document.querySelector("#shortcutForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const saved = state.shortcuts.find((item) => item.name === "Minova Test");
    if (saved) navigateActive(saved.url);
    return { tabId: tab.id, saved };
  })()`);
  assert(shortcut.saved?.url === "https://example.com/", "Custom shortcut was not saved or normalized");
  await sleep(3500);
  const shortcutNavigation = await evaluate(shell, `({ url: getActiveTab()?.url, loading: getActiveTab()?.loading, error: getActiveTab()?.loadError })`);
  assert(shortcutNavigation.url === "https://example.com/" && !shortcutNavigation.error, "Custom shortcut did not load its page");
  report.checks.customShortcut = { ...shortcut, navigation: shortcutNavigation };
  save();

  const settings = await evaluate(shell, `(() => {
    const originalIds = state.tabs.map((tab) => tab.id);
    const settingsTab = openTab("minova://settings");
    return {
      settingsTabId: settingsTab.id,
      tabCount: state.tabs.length,
      originalTabsPreserved: originalIds.every((id) => state.tabs.some((tab) => tab.id === id)),
      activeUrl: getActiveTab()?.url,
      panelVisible: !settingsPage.classList.contains("hidden")
    };
  })()`);
  assert(settings.originalTabsPreserved && settings.activeUrl === "minova://settings" && settings.panelVisible, "Settings did not open in a separate working tab");
  report.checks.settingsTab = settings;
  save();

  const internalPages = await evaluate(shell, `(async () => {
    navigateActive("minova://passwords");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const passwords = {
      heading: document.querySelector(".settings-content h2")?.textContent,
      sections: document.querySelectorAll(".settings-section").length
    };
    navigateActive("minova://extensions");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const extensions = {
      heading: document.querySelector(".settings-content h2")?.textContent,
      sections: document.querySelectorAll(".settings-section").length
    };
    return { passwords, extensions };
  })()`);
  report.checks.internalPages = internalPages;
  save();
  assert(internalPages.passwords.heading === "Passwords and Autofill" && internalPages.passwords.sections >= 2, "Password manager did not render");
  assert(internalPages.extensions.heading === "Extensions" && internalPages.extensions.sections >= 2, "Extension manager did not render");

  const reloadTabId = await evaluate(shell, `(() => {
    closeTab(${JSON.stringify(settings.settingsTabId)});
    activateTab(${JSON.stringify(shortcut.tabId)});
    reloadActiveTab();
    return getActiveTab().id;
  })()`);
  await sleep(3500);
  const reload = await evaluate(shell, `(() => {
    const tab = state.tabs.find((item) => item.id === ${JSON.stringify(reloadTabId)});
    return { url: tab?.url, loading: tab?.loading, error: tab?.loadError };
  })()`);
  assert(reload.url === "https://example.com/" && reload.loading === false && !reload.error, "Reload did not restore the current page");
  report.checks.reload = reload;
  save();

  const serviceState = await evaluate(shell, `Promise.all([
    window.minova.getVersion(),
    window.minova.listExtensions(),
    window.minova.listPasswords()
  ]).then(([version, extensions, passwords]) => ({
    version,
    extensionCount: extensions.length,
    passwordCount: passwords.length
  }))`);
  assert(serviceState.version.electron.startsWith("43."), "The browser is not running the expected Electron 43 runtime");
  assert(serviceState.version.protectedContent?.runtime === "ecs", "The browser is not running the ECS protected-content runtime");
  report.checks.services = serviceState;
  save();

  const extensionToolbar = await evaluate(shell, `(() => {
    return {
      browserActionRegistered: Boolean(customElements.get("browser-action")),
      genericGlyph: Boolean(document.querySelector("#extensionsButton .extension-glyph")),
      genericText: document.querySelector("#extensionsButton").textContent.trim(),
      streamingButton: Boolean(document.querySelector("#streamingModeButton")),
      streamingAvailable: Boolean(state.version?.streamingMode?.available),
      streamingBrowser: state.version?.streamingMode?.browser || "",
      omniboxWidth: document.querySelector("#navigationForm").getBoundingClientRect().width
    };
  })()`);
  assert(extensionToolbar.browserActionRegistered, "The functional extension action element was not registered");
  assert(extensionToolbar.genericGlyph && extensionToolbar.genericText === "", "The generic E extension label is still present");
  assert(extensionToolbar.streamingButton && extensionToolbar.streamingAvailable, "Streaming Mode is unavailable in the toolbar");
  assert(["Microsoft Edge", "Google Chrome"].includes(extensionToolbar.streamingBrowser), "Streaming Mode did not find a certified browser");
  assert(extensionToolbar.omniboxWidth >= 200, "Pinned extensions collapsed the address bar");
  report.checks.extensionToolbar = extensionToolbar;
  save();

  await restoreTestData(shell);

  report.completedAt = new Date().toISOString();
  report.passed = true;
  save();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch(async (error) => {
  if (shellTarget) {
    try {
      await restoreTestData(shellTarget);
    } catch {
      // Preserve the original test failure in the report.
    }
  }
  report.failedAt = new Date().toISOString();
  report.passed = false;
  report.error = error.stack || error.message;
  save();
  console.error(error);
  process.exitCode = 1;
});
