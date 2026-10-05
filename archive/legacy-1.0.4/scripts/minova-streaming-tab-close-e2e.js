"use strict";

const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10158);
const targetUrl = process.argv.find((argument) => /^https:\/\//i.test(argument)) || "https://example.com/";
const reportPath = path.join(__dirname, "artifacts", `streaming-tab-close-${port}.json`);
const report = { port, targetUrl, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(target, method, params = {}, timeoutMs = 30000) {
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
        reject(new Error(message.error?.message || message.result.exceptionDetails?.exception?.description || message.result.exceptionDetails?.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMs = 30000) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result.result.value;
}

async function findShell() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const shell = (await response.json()).find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // The debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Minova shell target was not found.");
}

async function main() {
  save();
  const shell = await findShell();
  report.started = await evaluate(shell, `(async () => {
    const sourceTab = document.querySelector(".tab.active");
    const sourceTabId = sourceTab?.dataset.tabId || "";
    const result = await window.minova.openStreamingMode(sourceTabId, ${JSON.stringify(targetUrl)});
    const streaming = await window.minova.getStreamingModeState();
    return {
      sourceTabId,
      result,
      streaming,
      ownerTracked: streaming.sourceTabId === sourceTabId
    };
  })()`, 40000);
  save();

  assert(report.started.sourceTabId, "The source browser tab was not available.");
  assert(report.started.streaming.active, "Streaming Mode did not become active.");
  assert(report.started.ownerTracked, "Streaming Mode did not retain ownership of its source tab.");

  report.closedSource = await evaluate(shell, `(async () => {
    document.querySelector("#newTabButton").click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sourceTab = document.querySelector('[data-tab-id="${report.started.sourceTabId}"]');
    const replacementTabId = document.querySelector(".tab.active")?.dataset.tabId || "";
    sourceTab?.querySelector(".tab-close")?.click();
    return {
      replacementTabId,
      sourceStillVisible: Boolean(document.querySelector('[data-tab-id="${report.started.sourceTabId}"]')),
      tabCount: document.querySelectorAll(".tab").length
    };
  })()`);
  save();

  assert(report.closedSource.replacementTabId, "Opening a replacement tab failed.");
  assert(report.closedSource.replacementTabId !== report.started.sourceTabId, "The replacement tab did not become active.");
  assert(!report.closedSource.sourceStillVisible, "The Streaming Mode source tab remained in the tab strip.");

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await evaluate(shell, "window.minova.getStreamingModeState()");
    if (!state.active && !state.starting) {
      report.stopped = state;
      break;
    }
    await sleep(100);
  }

  assert(report.stopped, "Streaming Mode remained open after its source tab was closed.");
  assert(!report.stopped.sourceTabId, "Streaming Mode retained a closed source tab identifier.");
  report.finalUi = await evaluate(shell, `({
    activeTabId: document.querySelector(".tab.active")?.dataset.tabId || "",
    sourceStillVisible: Boolean(document.querySelector('[data-tab-id="${report.started.sourceTabId}"]')),
    exitHidden: document.querySelector("#exitStreamingModeButton").classList.contains("hidden"),
    omniboxReadOnly: document.querySelector("#omnibox").readOnly
  })`);
  assert(report.finalUi.activeTabId === report.closedSource.replacementTabId, "Closing the source tab changed the active replacement tab.");
  assert(!report.finalUi.sourceStillVisible, "The closed source tab returned after Streaming Mode stopped.");
  assert(report.finalUi.exitHidden && !report.finalUi.omniboxReadOnly, "The normal Minova toolbar did not return after closing the source tab.");

  report.passed = true;
  report.finishedAt = new Date().toISOString();
  save();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  process.exitCode = 1;
});
