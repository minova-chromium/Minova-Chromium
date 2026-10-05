"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const previewFile = path.join(root, "installer", "preview", "index.html");
const outputDirectory = path.join(root, "scripts", "artifacts", "installer-preview-1.0.2");
const reportPath = path.join(outputDirectory, "preview-report.json");
const browserCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
];
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
const previews = [
  { name: "minova-1.0.2-installer.png", screen: "installer", width: 940, height: 620 },
  { name: "minova-1.0.2-installing.png", screen: "progress", width: 940, height: 620 },
  { name: "minova-1.0.2-update-ready.png", screen: "update", width: 680, height: 520 }
];

async function inspectLayout(page) {
  return page.evaluate(() => {
    const rootElement = document.documentElement;
    const body = document.body;
    const visibleElements = [...document.querySelectorAll(
      "h1, h2, p, label, button, a, li, input, small, strong, .version-block span"
    )].filter((element) => {
      const styles = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return styles.display !== "none"
        && styles.visibility !== "hidden"
        && bounds.width > 0
        && bounds.height > 0;
    });
    const overflowingElements = visibleElements
      .filter((element) => element.scrollWidth > element.clientWidth + 2
        || element.scrollHeight > element.clientHeight + 2)
      .map((element) => ({
        selector: element.id ? `#${element.id}` : element.className || element.tagName,
        text: String(element.value || element.textContent || "").trim().slice(0, 80),
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight]
      }));

    return {
      viewport: [innerWidth, innerHeight],
      documentSize: [rootElement.scrollWidth, rootElement.scrollHeight],
      bodySize: [body.scrollWidth, body.scrollHeight],
      logoLoaded: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      overflowingElements
    };
  });
}

async function main() {
  assert(executablePath, "Microsoft Edge or Google Chrome is required for preview validation.");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--force-device-scale-factor=1"]
  });
  const report = {
    version: "1.0.2",
    executablePath,
    previews: []
  };

  try {
    for (const preview of previews) {
      const page = await browser.newPage({
        viewport: { width: preview.width, height: preview.height },
        deviceScaleFactor: 1
      });
      const url = new URL(pathToFileURL(previewFile));
      url.searchParams.set("screen", preview.screen);
      await page.goto(url.href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const layout = await inspectLayout(page);

      assert.equal(layout.documentSize[0], preview.width, `${preview.screen} preview has horizontal overflow.`);
      assert.equal(layout.documentSize[1], preview.height, `${preview.screen} preview has vertical overflow.`);
      assert(layout.logoLoaded, `${preview.screen} preview did not load the Minova logo.`);
      assert.deepEqual(layout.overflowingElements, [], `${preview.screen} preview contains clipped text.`);

      const screenshotPath = path.join(outputDirectory, preview.name);
      await page.screenshot({ path: screenshotPath });
      const previewReport = {
        screen: preview.screen,
        screenshotPath,
        ...layout
      };

      if (preview.screen === "installer") {
        await page.click("#installButton");
        await page.waitForFunction(() => !document.querySelector("#progressStep").classList.contains("hidden"));
        const installingLabel = await page.textContent("#progressStatus");
        await page.waitForFunction(
          () => !document.querySelector("#completeStep").classList.contains("hidden"),
          null,
          { timeout: 8000 }
        );
        previewReport.interaction = {
          progressOpened: true,
          installingLabel,
          completed: true,
          finalAction: await page.textContent("#installButton span")
        };
        assert.match(previewReport.interaction.installingLabel, /Preparing|Installing/);
        assert.equal(previewReport.interaction.finalAction, "Open Minova");
      }

      if (preview.screen === "update") {
        previewReport.interaction = {
          laterAction: await page.textContent(".update-footer .secondary-button"),
          updateAction: await page.textContent(".update-button span")
        };
        assert.equal(previewReport.interaction.laterAction, "Later");
        assert.equal(previewReport.interaction.updateAction, "Restart and update");
      }

      report.previews.push(previewReport);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  report.passed = true;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    version: "1.0.2",
    passed: false,
    error: error.stack || error.message
  }, null, 2));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
