"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";
const outputDirectory = path.join(__dirname, "artifacts", "website");
const expectedInstallerUrl = "https://github.com/minova-chromium/Minova-Chromium/releases/download/v1.0.5/Minova-Chromium-Setup-1.0.5.exe";
const releaseFixture = {
  id: 105,
  tag_name: "v1.0.5",
  name: "Minova Chromium 1.0.5",
  body: "## Safari-Style Interface\n- **Third complete layout:** Workspace, Classic, or Safari\n- **Focused Smart Search:** Centered search and integrated tools\n\n## Liquid Glass Theme\n- **Layered translucent chrome:** Practical contrast and depth",
  draft: false,
  prerelease: false,
  published_at: "2026-08-13T00:00:00Z",
  html_url: "https://github.com/minova-chromium/Minova-Chromium/releases/tag/v1.0.5",
  assets: [{
    name: "Minova-Chromium-Setup-1.0.5.exe",
    browser_download_url: expectedInstallerUrl,
    size: 106000000
  }]
};
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
const report = {
  baseUrl,
  executablePath,
  pages: {},
  consoleErrors: [],
  failedRequests: []
};

async function assertNoHorizontalOverflow(page, name) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${name} has horizontal overflow: ${JSON.stringify(dimensions)}`
  );
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  assert(executablePath, "Microsoft Edge was not found for website testing.");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu"]
  });

  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await desktop.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(`${page.url()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      report.consoleErrors.push(`${page.url()}: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      if (request.url() === expectedInstallerUrl && request.failure()?.errorText === "net::ERR_ABORTED") return;
      if (/\/assets\/media\/[^/]+\.mp4$/i.test(request.url()) && request.failure()?.errorText === "net::ERR_ABORTED") return;
      report.failedRequests.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`);
    });
    await page.route("https://api.github.com/repos/minova-chromium/Minova-Chromium/releases?per_page=20", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([releaseFixture])
    }));

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    assert.equal(await page.title(), "Minova Chromium | A browser that feels like yours");
    assert.equal(await page.locator("h1").textContent(), "Minova Chromium");
    assert(await page.locator(".hero-logo").isVisible(), "Hero logo is not visible.");
    assert(await page.locator(".proof-strip").isVisible(), "The next-section signal is not visible.");
    assert(await page.locator("#version-1-0-5").isVisible(), "The 1.0.5 showcase is not visible.");
    assert(await page.locator("#version-1-0-4").isVisible(), "The 1.0.4 showcase is not visible.");
    assert(await page.locator("#version-1-0-3").isVisible(), "The 1.0.3 interface history is not visible.");
    assert.equal(await page.locator('img[src$="minova-assistant-1.0.4.png"]').count(), 1);
    assert.equal(await page.locator('img[src$="minova-workspaces.png"]').count(), 1);
    assert.equal(await page.locator('img[src$="minova-first-run.png"]').count(), 1);
    assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
    const promo = page.locator(".promo-video");
    assert.equal(await promo.locator('source[src$="minova-chromium-1.0.5-promo.mp4"]').count(), 1);
    assert.equal(await promo.locator('track[src$="minova-chromium-1.0.5-promo.en.vtt"]').count(), 1);
    assert.match(await promo.getAttribute("poster"), /minova-chromium-1\.0\.5-promo-cover\.png$/);
    assert.match(await promo.getAttribute("controlslist"), /nodownload/);
    assert.equal(await promo.locator("track[default]").count(), 0, "Captions should remain optional.");
    const downloadUrls = await page.locator("[data-download-link]").evaluateAll((links) => links.map((link) => link.href));
    assert(downloadUrls.length > 0, "No direct download links were found.");
    assert(downloadUrls.every((url) => url === expectedInstallerUrl && /\.exe$/i.test(url)), JSON.stringify(downloadUrls));
    await page.route(expectedInstallerUrl, (route) => route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "content-disposition": 'attachment; filename="Minova-Chromium-Setup-1.0.5.exe"' },
      body: "MZ"
    }));
    const downloadPromise = page.waitForEvent("download");
    await page.locator("[data-download-link]").first().click();
    const installerDownload = await downloadPromise;
    assert.equal(installerDownload.suggestedFilename(), "Minova-Chromium-Setup-1.0.5.exe");
    await installerDownload.cancel();
    await assertNoHorizontalOverflow(page, "Desktop home");

    await page.locator("[data-theme-lab]").scrollIntoViewIfNeeded();
    const firstAccent = await page.locator("[data-theme-lab]").evaluate((element) => getComputedStyle(element).getPropertyValue("--demo-accent").trim());
    await page.waitForTimeout(2400);
    const animatedAccent = await page.locator("[data-theme-lab]").evaluate((element) => getComputedStyle(element).getPropertyValue("--demo-accent").trim());
    assert.notEqual(firstAccent, animatedAccent, "The automatic color demonstration did not animate.");
    await page.locator('[data-palette="Crimson"]').click();
    const crimsonAccent = await page.locator("[data-theme-lab]").evaluate((element) => getComputedStyle(element).getPropertyValue("--demo-accent").trim());
    assert.equal(crimsonAccent, "#ff5c78");
    await page.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.activeElement?.blur();
    });
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(outputDirectory, "home-desktop.png"), fullPage: true });
    report.pages.home = { themeAnimation: true, crimsonAccent, directInstaller: true };

    await page.goto(`${baseUrl}/videos.html`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").textContent(), "Update Videos");
    assert.equal(await page.locator(".release-film").count(), 3);
    assert.equal(await page.locator(".release-film video").count(), 3);
    assert.equal(await page.locator('source[src$="minova-chromium-1.0.5-promo.mp4"]').count(), 1);
    assert.equal(await page.locator('source[src$="minova-chromium-1.0.4-promo.mp4"]').count(), 1);
    assert.equal(await page.locator('source[src$="minova-chromium-1.0.3-promo.mp4"]').count(), 1);
    assert.equal(await page.locator('.release-film video[controlslist*="nodownload"]').count(), 3);
    assert.equal(await page.locator(".release-film track[default]").count(), 0);
    assert.equal(await page.locator(".release-film video").evaluateAll((videos) => videos.every((video) => video.readyState >= 1)), true);
    await assertNoHorizontalOverflow(page, "Desktop videos");
    await page.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(outputDirectory, "videos-desktop.png"), fullPage: true });
    report.pages.videos = { releaseFilms: 3, captionsOptional: true, downloadsHidden: true };

    await page.goto(`${baseUrl}/brand.html`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").textContent(), "Shape your own path.");
    assert(await page.locator(".brand-page-lockup").isVisible(), "The primary brand lockup is not visible.");
    assert.equal(await page.locator(".brand-color-grid > div").count(), 6);
    assert(await page.locator('a[download][href$="Minova-Brand-Kit-2.1.zip"]').count() >= 1);
    assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
    await assertNoHorizontalOverflow(page, "Desktop brand");
    await page.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(outputDirectory, "brand-desktop.png"), fullPage: true });
    report.pages.brand = { lockup: true, colorSwatches: 6, directKitDownload: true };

    await page.goto(`${baseUrl}/features.html`, { waitUntil: "networkidle" });
    const capabilityCount = await page.locator(".capability").count();
    assert(capabilityCount >= 40, `Expected at least 40 capabilities, found ${capabilityCount}.`);
    assert.equal(await page.locator("#interface .capability").count(), 8);
    assert(await page.locator("#assistant").isVisible(), "The Minova Assistant guide is not visible.");
    await assertNoHorizontalOverflow(page, "Desktop features");
    await page.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(outputDirectory, "features-desktop.png"), fullPage: true });
    report.pages.features = { capabilityCount, interfaceCapabilities: 8 };

    await page.goto(`${baseUrl}/releases.html`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#latest-release-title [data-release-version]").textContent(), "1.0.5");
    assert.match(await page.locator(".release-entry").first().textContent(), /Safari-Style Interface/);
    assert.equal(await page.locator("[data-release-status]").textContent(), "1 releases · Synced with GitHub");
    await assertNoHorizontalOverflow(page, "Desktop releases");
    await page.screenshot({ path: path.join(outputDirectory, "releases-desktop.png"), fullPage: true });
    report.pages.releases = { liveVersion: "1.0.5", synced: true };

    let feedbackPayload;
    await page.route("https://formsubmit.co/ajax/**", (route) => {
      feedbackPayload = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, message: "Thank you. Your feedback was sent." })
      });
    });
    await page.goto(`${baseUrl}/feedback.html?type=feature`, { waitUntil: "networkidle" });
    const feedbackDeepLink = await page.evaluate(() => ({
      href: window.location.href,
      query: window.location.search,
      value: document.querySelector("#feedbackType")?.value,
      activeType: document.querySelector("[data-feedback-type].active")?.dataset.feedbackType
    }));
    assert.equal(feedbackDeepLink.value, "feature", JSON.stringify(feedbackDeepLink));
    assert.equal(feedbackDeepLink.activeType, "feature", JSON.stringify(feedbackDeepLink));
    assert.equal(await page.locator("[data-release-version-input]").inputValue(), "1.0.5");
    const contactInputTops = await page.locator(".public-feedback-form .form-grid").first().locator("input").evaluateAll(
      (inputs) => inputs.map((input) => input.getBoundingClientRect().top)
    );
    assert.equal(contactInputTops.length, 2);
    assert(Math.abs(contactInputTops[0] - contactInputTops[1]) < 1, JSON.stringify(contactInputTops));
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill("not-an-email");
    await page.locator('input[name="subject"]').fill("Add vertical tabs");
    await page.locator('textarea[name="description"]').fill("A vertical tab option would make large browsing sessions easier to organize.");
    await page.locator("#feedbackSubmit").click();
    assert.equal(await emailInput.evaluate((input) => input.validity.valid), false);
    assert.equal(feedbackPayload, undefined);
    await emailInput.fill("");
    await page.locator("#feedbackSubmit").click();
    await page.locator("#feedbackStatus.success").waitFor();
    assert.match(await page.locator("#feedbackStatus").textContent(), /feedback was sent/i);
    assert(feedbackPayload, "The feedback request was not captured.");
    assert.equal(Object.hasOwn(feedbackPayload, "email"), false, JSON.stringify(feedbackPayload));
    await assertNoHorizontalOverflow(page, "Desktop feedback");
    await page.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.activeElement?.blur();
    });
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(outputDirectory, "feedback-desktop.png"), fullPage: true });
    report.pages.feedback = { featureDeepLink: true, submissionFlow: true, emailOptional: true, alignedFields: true };
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const mobilePage = await mobile.newPage();
    mobilePage.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(`${mobilePage.url()}: ${message.text()}`);
    });
    mobilePage.on("pageerror", (error) => {
      report.consoleErrors.push(`${mobilePage.url()}: ${error.message}`);
    });
    await mobilePage.route("https://api.github.com/repos/minova-chromium/Minova-Chromium/releases?per_page=20", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([releaseFixture])
    }));
    await mobilePage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    assert(await mobilePage.locator(".hero h1").isVisible(), "Mobile hero is not visible.");
    assert(await mobilePage.locator(".proof-strip").isVisible(), "Mobile next-section signal is not visible.");
    await mobilePage.locator("[data-menu-toggle]").click();
    assert.equal(await mobilePage.locator("[data-mobile-navigation]").getAttribute("class"), "mobile-navigation open");
    await mobilePage.waitForTimeout(250);
    await mobilePage.screenshot({ path: path.join(outputDirectory, "mobile-menu.png"), fullPage: false });
    await mobilePage.locator("[data-menu-toggle]").click();
    await assertNoHorizontalOverflow(mobilePage, "Mobile home");
    await mobilePage.locator("[data-reveal]").evaluateAll((elements) => elements.forEach((element) => element.classList.add("visible")));
    await mobilePage.waitForTimeout(650);
    await mobilePage.screenshot({ path: path.join(outputDirectory, "home-mobile.png"), fullPage: true });
    report.pages.mobile = { navigation: true, width: 390, height: 844 };
    await mobile.close();

    assert.deepEqual(report.consoleErrors, [], `Console errors found:\n${report.consoleErrors.join("\n")}`);
    assert.deepEqual(report.failedRequests, [], `Failed requests found:\n${report.failedRequests.join("\n")}`);
    report.passed = true;
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exitCode = 1;
});
