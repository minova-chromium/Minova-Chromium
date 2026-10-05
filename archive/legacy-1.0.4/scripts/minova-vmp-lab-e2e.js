const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10125);
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `vmp-lab-${port}.json`);
const screenshotPath = path.join(artifacts, `vmp-lab-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(target, method, params = {}, timeoutMs = 20000) {
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
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMs) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result.result.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, description, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint or navigation may still be starting.
    }
    await sleep(250);
  }
  throw new Error(`${description} target was not found`);
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"), "Minova shell");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)")) break;
    await sleep(250);
  }
  assert(
    await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)"),
    "Minova did not finish initializing before the VMP lab test"
  );
  const tabId = await evaluate(shell, `openTab("https://castlabs.github.io/wv-vmp-lab/").id`);
  report.tabId = tabId;

  const lab = await findTarget(
    (target) => target.url.startsWith("https://castlabs.github.io/wv-vmp-lab/"),
    "Castlabs VMP lab"
  );
  await command(lab, "Page.enable");
  await sleep(3000);

  report.initial = await evaluate(lab, `({
    title: document.title,
    url: location.href,
    text: document.body.innerText,
    buttons: Array.from(document.querySelectorAll("button")).map((button) => button.innerText.trim()).filter(Boolean)
  })`);

  report.clicked = await evaluate(lab, `(() => {
    const control = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], a"))
      .find((element) => /load content|start|test|play/i.test((element.innerText || element.value || "").trim()));
    if (!control) return { clicked: false };
    control.click();
    return { clicked: true, label: (control.innerText || control.value || "").trim() };
  })()`);

  await sleep(9000);
  report.result = await evaluate(lab, `({
    text: document.body.innerText,
    videos: Array.from(document.querySelectorAll("video")).map((video) => ({
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      readyState: video.readyState,
      error: video.error ? { code: video.error.code, message: video.error.message } : null
    }))
  })`);

  const screenshot = await command(lab, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshotPath = screenshotPath;

  const combinedText = `${report.initial.text}\n${report.result.text}`;
  assert(!/widevine.*(not found|unavailable)|unsupported key system/i.test(combinedText), "The VMP lab reported that Widevine is unavailable");
  assert(!/license request failed|failed to create media keys/i.test(combinedText), "The VMP lab could not create or license Widevine media keys");
  assert(!/PLATFORM_TAMPERED/i.test(combinedText), "The ECS executable needs a valid VMP signature");

  await evaluate(shell, `closeTab(${JSON.stringify(tabId)}); true`);
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
