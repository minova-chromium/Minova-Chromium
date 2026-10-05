const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10176);
const targetUrl = process.argv.find((argument) => /^https:\/\//i.test(argument)) || "https://www.netflix.com/";
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `streaming-prompt-${port}.json`);
const screenshotPath = path.join(artifacts, `streaming-prompt-${port}.png`);
const report = { port, targetUrl, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function save() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
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

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return response.json();
}

async function findTarget(predicate, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint or child surface may still be starting.
    }
    await sleep(150);
  }
  throw new Error("Expected Minova debugging target was not found.");
}

async function waitFor(shell, expression, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await evaluate(shell, expression);
    if (value) return value;
    await sleep(150);
  }
  return null;
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  report.layout = await evaluate(shell, `(() => {
    const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
    const content = document.querySelector(".content").getBoundingClientRect();
    return { toolbarHeight: toolbar.height, toolbarBottom: toolbar.bottom, contentTop: content.top, build: new URL(location.href).searchParams.get("build") };
  })()`);
  assert(report.layout.toolbarHeight === 60, `Toolbar height is ${report.layout.toolbarHeight}px instead of 60px.`);
  assert(report.layout.contentTop === 102 && report.layout.toolbarBottom === 102, "The page surface is not aligned below the enlarged toolbar.");

  await evaluate(shell, `navigateActive(${JSON.stringify(targetUrl)}); true`);
  report.prompt = await waitFor(shell, `(async () => {
    const status = await window.minova.getStreamingPromptStatus();
    return status.visible ? status : null;
  })()`);
  assert(report.prompt, "The Streaming Mode suggestion did not appear.");
  assert(report.prompt.service === "Netflix", `The prompt identified ${report.prompt.service || "no service"} instead of Netflix.`);
  assert(report.prompt.bounds.y === report.prompt.parentBounds.y + report.prompt.chromeHeight + 10, "The prompt is not positioned directly below Minova's toolbar.");

  const prompt = await findTarget((target) => target.url.includes("streaming-prompt.html"));
  report.promptUi = await evaluate(prompt, `({
    title: document.querySelector("#promptTitle").textContent,
    message: document.querySelector("#promptMessage").textContent,
    button: document.querySelector("#enterButton").textContent
  })`);
  const screenshot = await command(prompt, "Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;

  await evaluate(prompt, `document.querySelector("#enterButton").click(); true`);
  report.streaming = await waitFor(shell, `(async () => {
    const state = await window.minova.getStreamingModeState();
    return state.active ? state : null;
  })()`, 220);
  assert(report.streaming?.active, "The prompt button did not enter Streaming Mode.");
  await evaluate(shell, `window.minova.exitStreamingMode()`);
  const stopped = await waitFor(shell, `(async () => {
    const state = await window.minova.getStreamingModeState();
    return !state.active && !state.starting ? state : null;
  })()`);
  assert(stopped, "Streaming Mode did not exit cleanly after the prompt test.");

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
