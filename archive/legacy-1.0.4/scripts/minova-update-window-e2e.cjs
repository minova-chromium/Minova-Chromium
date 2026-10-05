"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(__dirname, "artifacts", "update-window-1.0.2");
const screenshotPath = path.join(outputDirectory, "update-ready.png");
const installingScreenshotPath = path.join(outputDirectory, "update-installing.png");
const reportPath = path.join(outputDirectory, "report.json");
const executablePath = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find((candidate) => fs.existsSync(candidate));

async function main() {
  assert(executablePath, "Microsoft Edge or Google Chrome is required.");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 680, height: 520 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__minovaUpdateActions = [];
    window.minovaUpdate = {
      choose(action) {
        window.__minovaUpdateActions.push(action);
      },
      onDetails(callback) {
        setTimeout(() => callback({
          version: "1.0.2",
          releaseNotes: [
            "New polished installer and update experience",
            "Faster startup and smoother tab handling",
            "Reliability fixes across browsing and streaming mode"
          ].join("\n")
        }), 0);
      },
      onInstalling(callback) {
        window.__showMinovaInstalling = callback;
      }
    };
  });

  try {
    const url = pathToFileURL(path.join(root, "src", "update-window.html")).href;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#versionText").textContent === "1.0.2");
    const ready = await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      notes: [...document.querySelectorAll("#releaseNotes li")].map((item) => item.textContent),
      imageLoaded: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      readyVisible: !document.querySelector("#readyView").classList.contains("hidden")
    }));
    assert.deepEqual(ready.viewport, [680, 520]);
    assert.deepEqual(ready.document, [680, 520]);
    assert.equal(ready.notes.length, 3);
    assert.equal(ready.imageLoaded, true);
    assert.equal(ready.readyVisible, true);
    await page.screenshot({ path: screenshotPath });

    await page.click('[data-action="update"]');
    const installing = await page.evaluate(() => ({
      action: window.__minovaUpdateActions.at(-1),
      visible: !document.querySelector("#installingView").classList.contains("hidden"),
      readyHidden: document.querySelector("#readyView").classList.contains("hidden")
    }));
    assert.deepEqual(installing, { action: "update", visible: true, readyHidden: true });
    await page.screenshot({ path: installingScreenshotPath });
    assert.deepEqual(errors, []);

    const report = {
      passed: true,
      ready,
      installing,
      screenshotPath,
      installingScreenshotPath,
      errors
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    passed: false,
    error: error.stack || error.message
  }, null, 2));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
