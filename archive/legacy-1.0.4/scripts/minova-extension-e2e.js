const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10060);
const reportPath = path.join(__dirname, "artifacts", `extension-${port}.json`);
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

async function command(target, method, params = {}, timeoutMs = 20000) {
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

async function findTarget(predicate, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const target = (await targets()).find(predicate);
    if (target) return target;
    await sleep(500);
  }
  return null;
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  assert(shell, "Minova shell target was not found");

  const extension = await evaluate(shell, `window.minova.listExtensions().then((items) => items.find((item) => item.name === "Minova Extension Compatibility Test"))`);
  assert(extension?.id && extension.hasAction, "The Manifest V3 test extension was not loaded with an action");
  report.extension = { ...extension, icon: Boolean(extension.icon) };

  const exampleTabId = await evaluate(shell, `openTab("https://example.com/").id`);
  const example = await findTarget((target) => target.url === "https://example.com/");
  assert(example, "The extension test page did not open");
  await sleep(2500);
  report.contentScript = await evaluate(example, `({
    marker: document.documentElement.dataset.minovaExtensionTest || "",
    title: document.title,
    readyState: document.readyState
  })`);
  assert(report.contentScript.marker === "active", "The extension content script did not run in the webpage");

  report.toolbar = await evaluate(shell, `(() => {
    state.pinnedExtensions = [${JSON.stringify(extension.id)}];
    persistPinnedExtensions();
    renderPinnedExtensions();
    const button = document.querySelector("#pinnedExtensions .pinned-extension-button");
    return {
      exists: Boolean(button),
      is: button?.getAttribute("is") || "",
      constructorName: button?.constructor?.name || "",
      extensionId: button?.id || "",
      tab: button?.dataset.activeTab || "",
      visible: Boolean(button?.getClientRects().length),
      iconVisible: Boolean(button?.querySelector("img") || button?.classList.contains("no-icon")),
      webContentsId: getActiveTab()?.nativeWebContentsId || null
    };
  })()`);
  assert(report.toolbar.exists && report.toolbar.constructorName === "HTMLButtonElement", "A persistent extension toolbar action was not rendered");
  assert(report.toolbar.extensionId === extension.id && report.toolbar.tab && report.toolbar.visible && report.toolbar.iconVisible, "The extension action was not visible for the active native tab");

  const existingPopup = (await targets()).find((target) => target.url === `chrome-extension://${extension.id}/popup.html`);
  if (existingPopup) {
    await evaluate(existingPopup, `window.close(); true`);
    await sleep(500);
  }
  await evaluate(shell, `document.querySelector("#pinnedExtensions .pinned-extension-button").click()`);
  const popup = await findTarget((target) => target.url === `chrome-extension://${extension.id}/popup.html`);
  assert(popup, "Clicking the pinned extension did not open its real popup");
  await sleep(1200);
  report.popup = await evaluate(popup, `({
    activeTab: document.querySelector("#activeTab").textContent,
    storage: document.querySelector("#storageState").textContent,
    title: document.title
  })`);
  assert(report.popup.activeTab.includes("Example Domain") && report.popup.activeTab.includes("https://example.com/"), "chrome.tabs.query did not return Minova's active tab");
  assert(report.popup.storage.includes("contentScriptReady"), "chrome.storage did not persist content-script state");

  await evaluate(popup, `document.querySelector("#createTab").click()`);
  const createdPage = await findTarget((target) => target.url === "https://example.org/");
  assert(createdPage, "chrome.tabs.create did not create a native Minova tab");
  report.createdTab = await evaluate(shell, `(() => {
    const tab = state.tabs.find((item) => item.url === "https://example.org/");
    return tab ? { id: tab.id, url: tab.url, active: tab.id === state.activeTabId, webContentsId: tab.nativeWebContentsId } : null;
  })()`);
  assert(report.createdTab?.active && report.createdTab.webContentsId, "The extension-created tab was not adopted and activated by Minova");

  await evaluate(shell, `closeTab(${JSON.stringify(exampleTabId)}); true`);
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
