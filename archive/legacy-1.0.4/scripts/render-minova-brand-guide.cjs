"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const brandRoot = path.join(root, "brand");
const guideUrl = pathToFileURL(path.join(brandRoot, "minova-brand-guide.html")).href;
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));

async function capture(page, viewport, destination, fullPage) {
  await page.setViewportSize(viewport);
  await page.goto(guideUrl, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => (
      image.complete ? null : new Promise((resolve) => image.addEventListener("load", resolve, { once: true }))
    )));
  });
  await page.screenshot({ path: destination, fullPage });
}

async function main() {
  if (!executablePath) throw new Error("Microsoft Edge is required to render the brand guide previews.");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await capture(page, { width: 1440, height: 810 }, path.join(brandRoot, "brand-guide-preview-desktop.png"), false);
    await capture(page, { width: 390, height: 844 }, path.join(brandRoot, "brand-guide-preview-mobile.png"), false);
    await capture(page, { width: 1440, height: 900 }, path.join(brandRoot, "brand-guide-full.png"), true);
  } finally {
    await browser.close();
  }
  process.stdout.write(`Rendered Minova brand guide previews in ${brandRoot}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
