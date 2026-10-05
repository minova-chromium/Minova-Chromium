"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, "..", "website", "assets", "minova-clean-browser.png");
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));

async function main() {
  if (!executablePath) throw new Error("Microsoft Edge was not found.");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu"]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1800, height: 1100 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await page.route("https://api.github.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assets: [] })
    }));
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.locator(".demo-browser").waitFor();

    await page.evaluate(() => {
      const original = document.querySelector(".demo-browser");
      if (!original) throw new Error("The Minova browser preview was not found.");

      const browserPreview = original.cloneNode(true);
      const pageSurface = browserPreview.querySelector(".demo-page");
      const shortcuts = browserPreview.querySelectorAll(".demo-shortcut");
      if (pageSurface) pageSurface.style.minHeight = "760px";
      if (shortcuts[1]) {
        shortcuts[1].querySelector("i").textContent = "M";
        shortcuts[1].lastChild.textContent = "Minova";
      }

      const shell = document.createElement("div");
      shell.className = "theme-lab";
      shell.style.display = "block";
      shell.style.width = "1600px";
      shell.appendChild(browserPreview);

      document.documentElement.classList.remove("js-ready");
      document.body.replaceChildren(shell);
      Object.assign(document.body.style, {
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        margin: "0",
        padding: "60px",
        background: "#0f1216"
      });
      browserPreview.style.width = "1600px";
      browserPreview.style.boxShadow = "none";
    });

    await page.locator(".demo-browser img").evaluateAll((images) => Promise.all(
      images.map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => image.addEventListener("load", resolve, { once: true })))
    ));
    await page.locator(".demo-browser").screenshot({ path: outputPath });
    const dimensions = await page.locator(".demo-browser").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height
    }));
    console.log(JSON.stringify({ outputPath, dimensions, deviceScaleFactor: 2 }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
