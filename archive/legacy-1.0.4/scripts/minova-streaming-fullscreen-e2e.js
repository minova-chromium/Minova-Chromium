const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10231);
const targetUrl = process.argv.find((argument) => /^https:\/\//i.test(argument))
  || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const holdFullscreen = process.argv.includes("--hold");
const reportPath = path.join(__dirname, "artifacts", `streaming-fullscreen-${port}.json`);
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

async function findShell() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const shell = targets.find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // The debug endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Minova shell target was not found.");
}

async function evaluate(target, expression, timeoutMilliseconds = 30000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Runtime.evaluate timed out."));
    }, timeoutMilliseconds);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true }
    })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
        return;
      }
      resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", reject);
  });
}

async function waitForFullscreen(shell, expected) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await evaluate(shell, "window.minova.getStreamingModeState()");
    if (Boolean(state.fullscreen) === expected) return state;
    await sleep(100);
  }
  throw new Error(`Streaming Mode did not ${expected ? "enter" : "leave"} fullscreen.`);
}

async function main() {
  save();
  const shell = await findShell();
  report.opened = await evaluate(shell, `(async () => {
    const activeTab = document.querySelector(".tab.active");
    const result = await window.minova.openStreamingMode(activeTab?.dataset.tabId || "", ${JSON.stringify(targetUrl)});
    return { result, state: await window.minova.getStreamingModeState() };
  })()`, 40000);
  assert(report.opened.state.active, "Streaming Mode did not become active.");
  await sleep(1500);

  report.enterCommand = await evaluate(shell, "window.minova.toggleFullscreenWindow()");
  report.fullscreen = await waitForFullscreen(shell, true);
  assert(report.fullscreen.active, "Streaming Mode stopped while entering fullscreen.");
  await sleep(500);

  if (holdFullscreen) {
    report.holding = true;
    save();
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  report.exitCommand = await evaluate(shell, "window.minova.toggleFullscreenWindow()");
  report.restored = await waitForFullscreen(shell, false);
  assert(report.restored.active, "Streaming Mode stopped while leaving fullscreen.");
  assert(report.restored.bounds?.width >= 320 && report.restored.bounds?.height >= 240, "Embedded bounds were not restored.");

  await evaluate(shell, "window.minova.exitStreamingMode()");
  report.closed = await evaluate(shell, "window.minova.getStreamingModeState()");
  assert(!report.closed.active && !report.closed.error, "Streaming Mode did not close cleanly after fullscreen.");

  report.passed = true;
  report.finishedAt = new Date().toISOString();
  save();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  process.exitCode = 1;
});
