"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10329);
const reportPath = path.join(__dirname, "artifacts", `update-theme-${port}.json`);
const screenshotPath = path.join(__dirname, "artifacts", `update-theme-${port}.png`);
const appearanceScreenshotPath = path.join(__dirname, "artifacts", `update-theme-appearance-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForTarget(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The browser may still be starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function command(target, method, params = {}, timeoutMilliseconds = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMilliseconds);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
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
  const shell = await waitForTarget((target) => target.url.includes("/src/index.html"), "the Minova shell");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(shell, "Boolean(typeof state !== 'undefined' && state.settings && state.version && state.tabs.length)")) break;
    await sleep(100);
  }

  report.theme = await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({
      theme: "custom",
      customThemeColors: {
        background: "#102030",
        panel: "#203040",
        panelAlt: "#304050",
        border: "#506070",
        text: "#f7f8f9",
        muted: "#a1b2c3",
        accent: "#20d0a0",
        accentAlt: "#e5a020",
        danger: "#ff5070"
      }
    });
    applyTheme();
    openTab("minova://settings");
    renderSettings("appearance");
    const styles = getComputedStyle(document.documentElement);
    return {
      mode: document.documentElement.dataset.theme,
      background: styles.getPropertyValue("--bg").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      pickerCount: document.querySelectorAll("[data-theme-color]").length,
      textInputCount: document.querySelectorAll("[data-theme-color-text]").length,
      resetAvailable: Boolean(document.querySelector("#resetCustomThemeButton"))
    };
  })()`);
  assert.equal(report.theme.mode, "custom");
  assert.equal(report.theme.background, "#102030");
  assert.equal(report.theme.accent, "#20d0a0");
  assert.equal(report.theme.pickerCount, 9);
  assert.equal(report.theme.textInputCount, 9);
  assert.equal(report.theme.resetAvailable, true);
  const appearanceScreenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(appearanceScreenshotPath), { recursive: true });
  fs.writeFileSync(appearanceScreenshotPath, Buffer.from(appearanceScreenshot.data, "base64"));
  report.appearanceScreenshotPath = appearanceScreenshotPath;

  report.update = await evaluate(shell, `(async () => {
    const direct = await window.minova.checkForUpdates();
    renderSettings("about");
    const button = document.querySelector("#checkUpdatesButton");
    await checkForUpdates(button);
    return {
      direct,
      settingsButton: Boolean(button),
      statusText: document.querySelector("#updateStatusText")?.textContent || "",
      toast: document.querySelector(".toast")?.textContent || ""
    };
  })()`);
  assert.equal(report.update.direct.status, "unavailable");
  assert.match(report.update.direct.message, /installed Minova build|automated browser tests/i);
  assert.equal(report.update.settingsButton, true);
  assert.match(report.update.statusText, /installed Minova build|automated browser tests/i);

  await evaluate(shell, "document.querySelector('#mainMenuButton').click()");
  const menu = await waitForTarget((target) => target.url.includes("/src/quick-menu.html"), "the three-dot menu");
  await sleep(150);
  report.menu = await evaluate(menu, `(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      updateButton: Boolean(document.querySelector('[data-action="check-updates"]')),
      surface: styles.getPropertyValue("--menu-surface").trim(),
      accent: styles.getPropertyValue("--menu-accent").trim()
    };
  })()`);
  assert.equal(report.menu.updateButton, true);
  assert.equal(report.menu.surface, "#203040");
  assert.equal(report.menu.accent, "#20d0a0");
  await evaluate(shell, "window.minova.closeQuickMenu()");

  const screenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await evaluate(shell, `(async () => {
    state.settings = await window.minova.resetSettings();
    applyTheme();
    return true;
  })()`);

  report.screenshotPath = screenshotPath;
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exitCode = 1;
});
