"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const debuggingPort = Number(process.argv[2] || 10531);
const pagePort = Number(process.argv[3] || debuggingPort + 1);
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `assistant-${debuggingPort}.json`);
const screenshotPath = path.join(artifacts, `assistant-${debuggingPort}.png`);
const report = { debuggingPort, pagePort, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${debuggingPort}/json`)).json();
}

async function waitForTarget(predicate, description, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target) return target;
    } catch {
      // Electron may still be creating the debugging endpoint.
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
          || message.result?.exceptionDetails?.exception?.description
          || message.result?.exceptionDetails?.text
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

async function waitForExpression(target, expression, description, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(target, expression)) return;
    } catch {
      // The shell or hidden model host may be between lifecycle states.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function main() {
  const pageServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Minova AI Test Page</title><main><h1>Local intelligence</h1><p>Minova keeps assistant inference on this device.</p><p>Page summaries are sent only to the local model.</p></main>");
  });
  await new Promise((resolve, reject) => pageServer.listen(pagePort, "127.0.0.1", (error) => error ? reject(error) : resolve()));

  try {
    const shell = await waitForTarget((target) => target.url.includes("/src/index.html"), "the Minova shell");
    await waitForExpression(shell, "Boolean(typeof state !== 'undefined' && state.settings && state.tabs.length)", "Minova to boot");
    await evaluate(shell, `(() => { openTab("http://127.0.0.1:${pagePort}/"); return true; })()`);
    await waitForExpression(shell, `getActiveTab()?.url.startsWith("http://127.0.0.1:${pagePort}")`, "the local test page");

    await evaluate(shell, "setAssistantOpen(true)");
    await waitForExpression(shell, "state.assistantOpen && state.assistant.status === 'ready'", "the local model test engine");
    const engineTarget = await waitForTarget((target) => target.url.endsWith("/src/assistant-engine.html"), "the hidden local AI engine");

    const boundsOpen = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert(boundsOpen.assistantWidth >= 300);
    const visibleBounds = Object.values(boundsOpen.boundsByTabId).find(Boolean);
    assert(visibleBounds && visibleBounds.width > 0);
    assert.equal(visibleBounds.x + visibleBounds.width + boundsOpen.assistantWidth, boundsOpen.contentSize[0]);

    await evaluate(shell, `(() => {
      assistantInput.value = "Confirm that local AI is ready";
      document.querySelector("#assistantForm").requestSubmit();
      return true;
    })()`);
    await waitForExpression(shell, "assistantConversation.some((message) => message.role === 'assistant' && !message.pending && message.content.includes('local AI'))", "a streamed chat response");

    await evaluate(shell, "summarizeActivePageWithAssistant()");
    await waitForExpression(shell, "assistantConversation.filter((message) => message.role === 'assistant' && !message.pending).length >= 2", "a streamed page summary");

    report.ui = await evaluate(shell, `(async () => ({
      open: state.assistantOpen,
      status: state.assistant.status,
      webgpu: state.assistant.webgpu,
      modelId: state.assistant.modelId,
      messageCount: assistantConversation.length,
      streamedText: assistantConversation.filter((message) => message.role === "assistant").at(-1)?.content || "",
      panelWidth: Math.round(document.querySelector("#assistantSidebar").getBoundingClientRect().width),
      pageWidth: Object.values((await window.minova.getBrowserWorkspaceState()).boundsByTabId).find(Boolean)?.width || 0
    }))()`);
    assert.equal(report.ui.open, true);
    assert.equal(report.ui.status, "ready");
    assert.equal(report.ui.webgpu, true);
    assert.match(report.ui.streamedText, /Minova local AI is ready/);

    const screenshot = await command(shell, "Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

    await evaluate(shell, "setAssistantOpen(false, { initialize: false })");
    const boundsClosed = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    const closedVisibleBounds = Object.values(boundsClosed.boundsByTabId).find(Boolean);
    assert.equal(boundsClosed.assistantWidth, 0);
    assert(closedVisibleBounds.width > visibleBounds.width);

    report.engine = { url: engineTarget.url, hiddenHostPresent: true };
    report.bounds = { open: visibleBounds, closed: closedVisibleBounds };
    report.screenshotPath = screenshotPath;
    report.passed = true;
  } finally {
    pageServer.close();
  }
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
});
