const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10109);
const reportPath = path.join(__dirname, "artifacts", `window-layout-${port}.json`);
const screenshotPath = path.join(__dirname, "artifacts", `window-layout-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function findShell() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const shell = (await response.json()).find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // Electron's debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Minova shell target was not found");
}

async function main() {
  const shell = await findShell();
  if (!(await evaluate(shell, "window.minova.isWindowMaximized()"))) {
    await evaluate(shell, "window.minova.toggleMaximizeWindow()");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate(shell, "window.minova.isWindowMaximized()")) break;
      await sleep(50);
    }
  }
  await sleep(400);
  report.layout = await evaluate(shell, `(async () => {
    const app = document.querySelector(".app-shell").getBoundingClientRect();
    const titlebar = document.querySelector(".titlebar").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
    const menuButton = document.querySelector("#mainMenuButton").getBoundingClientRect();
    const sidebarWidth = Number.parseFloat(
      getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--sidebar-width")
    );
    return {
      build: new URL(location.href).searchParams.get("build"),
      maximized: await window.minova.isWindowMaximized(),
      restoreIcon: document.querySelector("#maximizeWindowButton").classList.contains("restore"),
      innerWidth,
      outerWidth,
      screenX,
      availableLeft: screen.availLeft,
      availableWidth: screen.availWidth,
      app: { left: app.left, right: app.right, width: app.width },
      titlebar: { left: titlebar.left, right: titlebar.right, width: titlebar.width },
      sidebar: { left: sidebar.left, right: sidebar.right, width: sidebar.width },
      sidebarWidth,
      toolbar: { left: toolbar.left, right: toolbar.right, width: toolbar.width },
      menuButton: { left: menuButton.left, right: menuButton.right, width: menuButton.width }
    };
  })()`);

  const shellEdgesMatch = [report.layout.app, report.layout.titlebar]
    .every((rect) => Math.abs(rect.left) < 0.5 && Math.abs(rect.right - report.layout.innerWidth) < 0.5);
  const sidebarMatchesLayout = Math.abs(report.layout.sidebar.left) < 0.5
    && Math.abs(report.layout.sidebar.right - report.layout.sidebarWidth) < 0.5
    && Math.abs(report.layout.toolbar.left - report.layout.sidebarWidth) < 0.5
    && Math.abs(report.layout.toolbar.right - report.layout.innerWidth) < 0.5;
  // Chromium reports screen.availWidth in physical pixels on some Windows DPI
  // configurations while innerWidth/outerWidth remain CSS pixels.
  const nativeFrameMatchesViewport = Math.abs(report.layout.outerWidth - report.layout.innerWidth) < 0.5;
  assert(report.layout.maximized && report.layout.restoreIcon, "Minova did not start in a synchronized maximized state");
  assert(shellEdgesMatch, "The shell does not reach both edges of the browser viewport");
  assert(sidebarMatchesLayout, "The toolbar and vertical sidebar do not share a clean boundary");
  const menuGap = report.layout.innerWidth - report.layout.menuButton.right;
  assert(Math.abs(menuGap) < 0.5, `Blank toolbar space remains after the three-dot button (${menuGap}px)`);
  assert(nativeFrameMatchesViewport, "The maximized native frame does not match the browser viewport");

  const screenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
});
