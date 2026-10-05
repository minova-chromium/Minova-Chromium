"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10555);
const artifactRoot = path.join(__dirname, "artifacts");
const reportPath = path.join(artifactRoot, `liquid-glass-${port}.json`);
const screenshotPath = path.join(artifactRoot, `liquid-glass-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForShell() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const shell = targets.find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // Electron may still be opening its DevTools endpoint.
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for the Minova shell.");
}

async function command(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, 20000);

    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", async (event) => {
      try {
        const raw = typeof event.data === "string"
          ? event.data
          : typeof event.data?.text === "function"
            ? await event.data.text()
            : Buffer.from(event.data).toString("utf8");
        const message = JSON.parse(raw);
        if (message.id !== 1) return;
        clearTimeout(timer);
        socket.close();
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(
            message.error?.message
            || message.result.exceptionDetails?.exception?.description
            || message.result.exceptionDetails?.text
          ));
          return;
        }
        resolve(message.result);
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
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

async function main() {
  const shell = await waitForShell();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(shell, "Boolean(typeof state !== 'undefined' && state.settings && state.tabs.length)")) break;
    await sleep(100);
  }

  report.theme = await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({
      tabLayout: "safari",
      theme: "liquid-glass"
    });
    applyTheme();
    applyInterfaceLayout();
    const settingsTab = openTab("minova://settings");
    activateTab(settingsTab.id);
    renderSettings("appearance");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const rootStyles = getComputedStyle(document.documentElement);
    const toolbarStyles = getComputedStyle(document.querySelector(".toolbar"));
    const activeTabStyles = getComputedStyle(document.querySelector(".tab.active"));
    const persisted = await window.minova.getSettings();
    return {
      mode: document.documentElement.dataset.theme,
      safariClass: appShell.classList.contains("safari-ui"),
      persistedTheme: persisted.theme,
      persistedLayout: persisted.tabLayout,
      optionAvailable: [...document.querySelectorAll('[data-setting="theme"] option')]
        .some((option) => option.value === "liquid-glass"),
      accent: rootStyles.getPropertyValue("--accent").trim(),
      toolbarBackdrop: toolbarStyles.backdropFilter || toolbarStyles.webkitBackdropFilter || "",
      activeTabRadius: activeTabStyles.borderRadius,
      chromeHeight: document.querySelector(".toolbar").getBoundingClientRect().bottom
        + document.querySelector(".sidebar").getBoundingClientRect().height
    };
  })()`);

  assert.equal(report.theme.mode, "liquid-glass");
  assert.equal(report.theme.safariClass, true);
  assert.equal(report.theme.persistedTheme, "liquid-glass");
  assert.equal(report.theme.persistedLayout, "safari");
  assert.equal(report.theme.optionAvailable, true);
  assert.equal(report.theme.accent, "#4be5d7");
  assert.match(report.theme.toolbarBackdrop, /blur\(36px\)/);
  assert.equal(report.theme.activeTabRadius, "14px");
  assert.equal(report.theme.chromeHeight, 102);

  const screenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await evaluate(shell, "window.minova.closeWindow()");
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exitCode = 1;
});
