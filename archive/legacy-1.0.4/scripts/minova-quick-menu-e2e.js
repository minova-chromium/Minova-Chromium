const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10087);
const reportPath = path.join(__dirname, "artifacts", `quick-menu-${port}.json`);
const screenshotPath = path.join(__dirname, "artifacts", `quick-menu-${port}.png`);
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

async function findTarget(predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Expected debugging target was not found");
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  const activeUrlBeforeMenu = await evaluate(shell, `(() => {
    state.history = [
      { url: "https://www.youtube.com/", title: "YouTube", visitedAt: Date.now() - 60000 },
      { url: "https://store.steampowered.com/", title: "Welcome to Steam", visitedAt: Date.now() - 3600000 }
    ];
    state.bookmarks = ["https://github.com/", "https://www.netflix.com/"];
    persistHistory();
    persistBookmarks();
    document.querySelector("#mainMenuButton").click();
    return getActiveTab()?.url || "";
  })()`);
  const menu = await findTarget((target) => target.url.includes("/src/quick-menu.html"));
  await sleep(400);

  report.openState = await evaluate(shell, `Promise.all([
    window.minova.getQuickMenuStatus(),
    Promise.resolve({ activeUrl: getActiveTab()?.url, tabCount: state.tabs.length })
  ]).then(([status, shellState]) => ({ ...status, ...shellState }))`);
  report.menu = await evaluate(menu, `({
    width: innerWidth,
    height: innerHeight,
    labels: Array.from(document.querySelectorAll("[data-action]")).map((item) => item.textContent.trim()).filter(Boolean),
    zoom: document.querySelector("#zoomValue").textContent,
    focusedRole: document.activeElement?.getAttribute("role") || ""
  })`);

  assert(report.openState.visible, "Quick menu did not become visible");
  assert(report.openState.activeViewVisible, "The active webpage was hidden while the quick menu was open");
  assert(!report.openState.browserViewsSuppressed, "Opening the quick menu still suppresses browser content");
  assert(report.openState.activeUrl === activeUrlBeforeMenu, "Opening the menu changed the active webpage");
  assert(report.menu.labels.includes("Passwords and autofill"), "Chrome-style menu commands were not rendered");
  assert(report.menu.labels.some((label) => label.startsWith("Developer tools")), "Tool commands were not rendered");

  await evaluate(menu, `(() => {
    document.querySelector('[data-action="history"]').dispatchEvent(new PointerEvent("pointerenter"));
    return true;
  })()`);
  const submenu = await findTarget((target) => target.url.includes("/src/quick-submenu.html"));
  await sleep(350);
  report.historyFlyout = await evaluate(submenu, `({
    title: document.querySelector("#submenuTitle").textContent,
    entries: Array.from(document.querySelectorAll(".submenu-item strong")).map((item) => item.textContent),
    manage: document.querySelector("#manageButton").textContent
  })`);
  report.flyoutStatus = await evaluate(shell, `window.minova.getQuickMenuStatus()`);
  assert(report.historyFlyout.title === "Recent history" && report.historyFlyout.entries.includes("YouTube"), "History flyout did not show recent pages");
  assert(report.flyoutStatus.submenuVisible && report.flyoutStatus.activeViewVisible, "History flyout hid the active webpage");

  await evaluate(menu, `(() => {
    document.querySelector('[data-action="bookmarks"]').dispatchEvent(new PointerEvent("pointerenter"));
    return true;
  })()`);
  await sleep(300);
  report.bookmarksFlyout = await evaluate(submenu, `({
    title: document.querySelector("#submenuTitle").textContent,
    entries: Array.from(document.querySelectorAll(".submenu-item strong")).map((item) => item.textContent),
    manage: document.querySelector("#manageButton").textContent
  })`);
  assert(report.bookmarksFlyout.title === "Bookmarks" && report.bookmarksFlyout.entries.length === 2, "Bookmarks flyout did not show saved bookmarks");
  const submenuScreenshot = await command(submenu, "Page.captureScreenshot", { format: "png" });
  const submenuScreenshotPath = path.join(__dirname, "artifacts", `quick-submenu-${port}.png`);
  fs.writeFileSync(submenuScreenshotPath, Buffer.from(submenuScreenshot.data, "base64"));
  report.submenuScreenshotPath = submenuScreenshotPath;

  await evaluate(submenu, `document.querySelector(".submenu-item").click(); true`);
  await sleep(500);
  report.openedBookmark = await evaluate(shell, `({ activeUrl: getActiveTab()?.url, tabCount: state.tabs.length })`);
  assert(report.openedBookmark.activeUrl === "https://github.com/", "Clicking a bookmark flyout item did not open it");

  await evaluate(shell, `document.querySelector("#mainMenuButton").click(); true`);
  await sleep(250);

  const screenshot = await command(menu, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;

  await evaluate(menu, `document.querySelector('[data-action="zoom-in"]').click(); true`);
  await sleep(300);
  report.zoom = {
    renderer: await evaluate(shell, `state.settings.defaultZoom`),
    menu: await evaluate(menu, `document.querySelector("#zoomValue").textContent`)
  };
  assert(report.zoom.renderer === 1.1 && report.zoom.menu === "110%", "Menu zoom controls did not stay synchronized");

  await evaluate(menu, `document.querySelector('[data-action="history"]').click(); true`);
  await sleep(400);
  report.afterHistory = await evaluate(shell, `({ activeUrl: getActiveTab()?.url, tabCount: state.tabs.length })`);
  assert(report.afterHistory.activeUrl === "minova://history", "History command did not open the History tab");

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
