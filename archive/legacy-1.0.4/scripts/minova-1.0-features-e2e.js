"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

const port = Number(process.argv[2] || 10317);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForTarget(predicate, description, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForNoTarget(predicate, description, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!(await targets()).some(predicate)) return;
    } catch {}
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
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const details = message.result?.exceptionDetails;
        const description = details?.exception?.description
          || details?.text
          || message.error?.message
          || "Unknown DevTools error";
        reject(new Error(description));
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

async function startFixture() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>Suspension Fixture</title></head><body><h1>Inactive tab</h1></body></html>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function waitForShellExpression(shell, expression, description, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(shell, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

(async () => {
  const fixture = await startFixture();
  let shell;
  let backgroundTabId = "";
  let foregroundTabId = "";
  let originalSettings;
  try {
    shell = await waitForTarget((target) => target.url.includes("/src/index.html"), "the Minova shell");
    originalSettings = await evaluate(shell, "window.minova.getSettings()");

    process.stdout.write("feedback-bug\n");
    await evaluate(shell, "window.minova.openFeedback('bug'); true");
    let feedback = await waitForTarget((target) => target.url.endsWith("/src/feedback.html"), "the bug feedback dialog");
    await waitForShellExpression(
      feedback,
      "Boolean(document.querySelector('#dialogTitle') && document.querySelector('#subject'))",
      "the bug feedback form"
    );
    const bugDialog = await evaluate(feedback, `({
      title: document.querySelector("#dialogTitle").textContent,
      subject: document.querySelector("#subject").value,
      emailType: document.querySelector("#email").type,
      descriptionLimit: document.querySelector("#description").maxLength
    })`);
    assert.deepEqual(bugDialog, {
      title: "Report a Bug",
      subject: "Bug Report",
      emailType: "email",
      descriptionLimit: 5000
    });
    await evaluate(feedback, "document.querySelector('#feedbackForm').requestSubmit(); true");
    assert.equal(
      await evaluate(feedback, "document.querySelector('#status').textContent"),
      "Enter a valid email address."
    );
    await evaluate(feedback, "setTimeout(() => window.minovaFeedback.close(), 0); true");
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/feedback.html"),
      "the bug feedback dialog to close"
    );

    process.stdout.write("feedback-feature\n");
    await evaluate(shell, "window.minova.openFeedback('feature'); true");
    feedback = await waitForTarget((target) => target.url.endsWith("/src/feedback.html"), "the feature feedback dialog");
    await waitForShellExpression(
      feedback,
      "Boolean(document.querySelector('#dialogTitle') && document.querySelector('#subject'))",
      "the feature feedback form"
    );
    assert.deepEqual(await evaluate(feedback, `({
      title: document.querySelector("#dialogTitle").textContent,
      subject: document.querySelector("#subject").value
    })`), { title: "Request a Feature", subject: "Feature Request" });
    await evaluate(feedback, "setTimeout(() => window.minovaFeedback.close(), 0); true");
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/feedback.html"),
      "the feature feedback dialog to close"
    );

    process.stdout.write("performance-ui\n");
    await evaluate(shell, `(async () => {
      state.settings = await window.minova.setSettings({
        smartTabSuspensionEnabled: true,
        tabSuspensionPreset: "custom",
        tabSuspensionCustomUnit: "hours",
        tabSuspensionTimeoutMinutes: 90
      });
      renderSettings("performance");
    })()`);
    const performanceUi = await evaluate(shell, `({
      value: document.querySelector("#tabSuspensionCustomValue").value,
      unit: document.querySelector("#tabSuspensionCustomUnit").value,
      enabled: document.querySelector('[data-setting="smartTabSuspensionEnabled"]').checked
    })`);
    assert.deepEqual(performanceUi, { value: "1.5", unit: "hours", enabled: true });

    await evaluate(shell, `(async () => {
      state.settings = await window.minova.setSettings({
        smartTabSuspensionEnabled: true,
        tabSuspensionPreset: "custom",
        tabSuspensionCustomUnit: "minutes",
        tabSuspensionTimeoutMinutes: 1
      });
    })()`);
    process.stdout.write("suspension-wait\n");
    backgroundTabId = await evaluate(shell, `openTab(${JSON.stringify(fixture.url)}).id`);
    await waitForShellExpression(
      shell,
      `state.tabs.find((tab) => tab.id === ${JSON.stringify(backgroundTabId)})?.loading === false`,
      "the suspension fixture"
    );
    foregroundTabId = await evaluate(shell, "openTab('minova://newtab').id");

    await sleep(61000);
    const automaticallySuspended = await evaluate(
      shell,
      `state.tabs.find((tab) => tab.id === ${JSON.stringify(backgroundTabId)})?.suspended === true`
    );
    const suspendedCount = await evaluate(shell, "window.minova.suspendInactiveTabsNow()", 20000);
    assert(
      automaticallySuspended || suspendedCount >= 1,
      "No eligible inactive tab was suspended automatically or manually."
    );
    await waitForShellExpression(
      shell,
      `state.tabs.find((tab) => tab.id === ${JSON.stringify(backgroundTabId)})?.suspended === true`,
      "the inactive tab to enter the suspended state"
    );

    await evaluate(shell, `activateTab(${JSON.stringify(backgroundTabId)}); true`);
    await waitForShellExpression(
      shell,
      `state.tabs.find((tab) => tab.id === ${JSON.stringify(backgroundTabId)})?.suspended === false`,
      "the selected tab to wake"
    );
    assert.equal(
      await evaluate(shell, `state.tabs.find((tab) => tab.id === ${JSON.stringify(backgroundTabId)})?.url`),
      fixture.url
    );
    const restoredPage = await waitForTarget(
      (target) => target.url === fixture.url,
      "the restored suspension fixture target"
    );
    assert.deepEqual(await evaluate(restoredPage, `({
      title: document.title,
      heading: document.querySelector("h1")?.textContent || ""
    })`), { title: "Suspension Fixture", heading: "Inactive tab" });

    console.log(JSON.stringify({
      passed: true,
      feedback: ["bug", "feature", "validation"],
      performanceUi,
      automaticSuspension: automaticallySuspended,
      suspendedCount,
      wakePreservedUrl: true,
      wakePreservedDom: true
    }, null, 2));
  } finally {
    if (shell) {
      if (backgroundTabId) {
        await evaluate(shell, `closeTab(${JSON.stringify(backgroundTabId)}); true`).catch(() => {});
      }
      if (foregroundTabId) {
        await evaluate(shell, `closeTab(${JSON.stringify(foregroundTabId)}); true`).catch(() => {});
      }
      if (originalSettings) {
        await evaluate(shell, `window.minova.setSettings(${JSON.stringify(originalSettings)})`).catch(() => {});
      }
    }
    await new Promise((resolve) => fixture.server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
