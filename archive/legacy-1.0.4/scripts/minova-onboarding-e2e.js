"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10427);
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `onboarding-${port}.json`);
const welcomeScreenshot = path.join(artifacts, `onboarding-welcome-${port}.png`);
const layoutScreenshot = path.join(artifacts, `onboarding-layout-${port}.png`);
const passwordsScreenshot = path.join(artifacts, `onboarding-passwords-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function saveReport() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForTarget(predicate, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint may still be starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForNoTarget(predicate, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!(await listTargets()).some(predicate)) return;
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function command(target, method, params = {}, timeoutMilliseconds = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMilliseconds);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const details = message.result?.exceptionDetails;
        reject(new Error(
          details?.exception?.description
          || details?.text
          || message.error?.message
          || "Unknown DevTools error"
        ));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMilliseconds) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMilliseconds);
  return result.result.value;
}

async function waitForExpression(target, expression, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(target, expression)) return;
    } catch {
      // The renderer may be between navigation and first paint.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function capture(target, destination) {
  const result = await command(target, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true
  });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(result.data, "base64"));
}

const isShell = (target) => target.url.includes("/src/index.html");
const isTour = (target) => target.url.endsWith("/src/onboarding.html");

(async () => {
  saveReport();
  let shell;
  let tour;
  try {
    shell = await waitForTarget(isShell, "the Minova browser shell");
    tour = await waitForTarget(isTour, "the first-launch tour");
    await waitForExpression(
      tour,
      "document.querySelector('#tourContent h1')?.textContent.includes('Set up Minova')",
      "the welcome step"
    );

    report.welcome = await evaluate(tour, `({
      step: document.querySelector("#progressLabel").textContent,
      title: document.querySelector("#tourContent h1").textContent,
      logoLoaded: document.querySelector(".welcome-logo").complete,
      skipVisible: !document.querySelector("#skipTourButton").classList.contains("hidden"),
      viewportFits:
        document.documentElement.scrollWidth <= innerWidth
        && document.documentElement.scrollHeight <= innerHeight
        && document.querySelector(".tour-footer").getBoundingClientRect().bottom <= innerHeight
    })`);
    assert.equal(report.welcome.logoLoaded, true);
    assert.equal(report.welcome.skipVisible, true);
    assert.equal(report.welcome.viewportFits, true);
    await capture(tour, welcomeScreenshot);

    await evaluate(tour, "document.querySelector('#nextButton').click(); true");
    await waitForExpression(
      tour,
      "document.querySelectorAll('[data-layout]').length === 2",
      "the interface selection step"
    );
    report.layoutChoices = await evaluate(tour, `[...document.querySelectorAll("[data-layout]")].map((button) => ({
      layout: button.dataset.layout,
      title: button.querySelector("strong").textContent,
      selected: button.classList.contains("selected")
    }))`);
    assert.deepEqual(report.layoutChoices.map((choice) => choice.layout), ["workspaces", "classic"]);
    await sleep(280);
    assert.equal(
      await evaluate(tour, "Number(getComputedStyle(document.querySelector('.step-page')).opacity) >= 0.99"),
      true
    );
    await capture(tour, layoutScreenshot);

    await evaluate(tour, "document.querySelector('[data-layout=\"classic\"]').click(); true");
    await waitForExpression(
      tour,
      "document.querySelector('[data-layout=\"classic\"]').classList.contains('selected')",
      "the Classic UI selection"
    );
    await waitForExpression(
      shell,
      `window.minova.getSettings().then((settings) =>
        settings.tabLayout === "classic"
        && document.querySelector(".app-shell").classList.contains("classic-ui")
      )`,
      "the live browser layout to change"
    );
    report.appliedLayout = await evaluate(shell, `window.minova.getSettings().then((settings) => ({
      setting: settings.tabLayout,
      classicClass: document.querySelector(".app-shell").classList.contains("classic-ui")
    }))`);
    assert.deepEqual(report.appliedLayout, { setting: "classic", classicClass: true });

    await evaluate(tour, "document.querySelector('#nextButton').click(); true");
    await waitForExpression(
      tour,
      "document.querySelector('.step-kicker')?.textContent === 'Classic UI selected'",
      "the Classic UI walkthrough"
    );
    report.workflowTitle = await evaluate(tour, "document.querySelector('#tourContent h1').textContent");

    await evaluate(tour, "document.querySelector('#skipTourButton').click(); true");
    await waitForExpression(
      tour,
      "document.querySelectorAll('[data-password-action]').length === 3",
      "the password import step after skipping"
    );
    report.passwordStep = await evaluate(tour, `({
      progress: document.querySelector("#progressLabel").textContent,
      actions: [...document.querySelectorAll("[data-password-action] strong")].map((node) => node.textContent),
      explainsGoogleBoundary: document.querySelector(".password-notice").textContent.includes("does not provide"),
      nextHidden: document.querySelector("#nextButton").classList.contains("hidden"),
      skipHidden: document.querySelector("#skipTourButton").classList.contains("hidden"),
      viewportFits:
        document.documentElement.scrollWidth <= innerWidth
        && document.documentElement.scrollHeight <= innerHeight
        && document.querySelector(".tour-footer").getBoundingClientRect().bottom <= innerHeight
    })`);
    assert.equal(report.passwordStep.actions.length, 3);
    assert.equal(report.passwordStep.explainsGoogleBoundary, true);
    assert.equal(report.passwordStep.nextHidden, true);
    assert.equal(report.passwordStep.skipHidden, true);
    assert.equal(report.passwordStep.viewportFits, true);
    await sleep(280);
    assert.equal(
      await evaluate(tour, "Number(getComputedStyle(document.querySelector('.step-page')).opacity) >= 0.99"),
      true
    );
    await capture(tour, passwordsScreenshot);

    await evaluate(tour, "document.querySelector('[data-password-action=\"later\"]').click(); true");
    await waitForNoTarget(isTour, "the completed first-launch tour");
    report.persisted = await evaluate(shell, `window.minova.getSettings().then((settings) => ({
      firstRunTourVersion: settings.firstRunTourVersion,
      googlePasswordImportState: settings.googlePasswordImportState,
      tabLayout: settings.tabLayout
    }))`);
    assert.deepEqual(report.persisted, {
      firstRunTourVersion: 1,
      googlePasswordImportState: "declined",
      tabLayout: "classic"
    });

    const replayOpened = await evaluate(shell, "window.minova.openFirstRunTour()");
    assert.equal(replayOpened, true);
    tour = await waitForTarget(isTour, "the replayed Minova tour");
    await waitForExpression(
      tour,
      "document.querySelector('#tourContent h1')?.textContent.includes('Set up Minova')",
      "the replayed welcome step"
    );
    report.replayAvailable = true;
    await evaluate(tour, "document.querySelector('#skipTourButton').click(); true");
    await waitForExpression(
      tour,
      "Boolean(document.querySelector('[data-password-action=\"later\"]'))",
      "the replayed password step"
    );
    await evaluate(tour, "document.querySelector('[data-password-action=\"later\"]').click(); true");
    await waitForNoTarget(isTour, "the replayed tour to close");

    report.passed = true;
    report.screenshots = [welcomeScreenshot, layoutScreenshot, passwordsScreenshot];
    report.finishedAt = new Date().toISOString();
    saveReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    report.passed = false;
    report.error = error.stack || error.message;
    if (tour) {
      try {
        report.failureState = await evaluate(tour, `({
          readyState: document.readyState,
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 1200) || "",
          contentHtml: document.querySelector("#tourContent")?.innerHTML?.slice(0, 1200) || "",
          apiType: typeof window.minovaTour,
          scriptSources: [...document.scripts].map((script) => script.src)
        })`);
        const failureScreenshot = path.join(artifacts, `onboarding-failure-${port}.png`);
        await capture(tour, failureScreenshot);
        report.failureScreenshot = failureScreenshot;
      } catch (diagnosticError) {
        report.diagnosticError = diagnosticError.stack || diagnosticError.message;
      }
    }
    report.finishedAt = new Date().toISOString();
    saveReport();
    console.error(error);
    process.exitCode = 1;
  }
})();
