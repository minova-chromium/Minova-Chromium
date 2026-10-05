const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10074);
const reportPath = path.join(__dirname, "artifacts", `adblock-${port}.json`);
const report = { port, startedAt: new Date().toISOString() };

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

async function command(target, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      const details = message.result?.exceptionDetails;
      if (message.error || details) {
        reject(new Error(message.error?.message || details?.exception?.description || details?.text));
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

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint may not be ready yet.
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  assert(shell, "Minova shell target was not found.");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)")) break;
    await sleep(250);
  }

  report.before = await evaluate(shell, "window.minova.getAdBlockState()");
  assert(report.before.ready && report.before.enabled, "Minova's ad blocker did not initialize and enable.");

  await evaluate(shell, `openTab("https://example.com/").id`);
  const page = await findTarget((target) => target.url === "https://example.com/");
  assert(page, "The ad-block test page did not open.");
  await evaluate(page, `(() => {
    const urls = [
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js?minova-test=1",
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?minova-test=1",
      "https://googleads.g.doubleclick.net/pagead/id?minova-test=1"
    ];
    for (const url of urls) {
      const script = document.createElement("script");
      script.src = url;
      document.head.appendChild(script);
    }
    return true;
  })()`);
  await sleep(3000);

  report.after = await evaluate(shell, "window.minova.getAdBlockState()");
  report.blockedDuringTest = report.after.blockedRequests - report.before.blockedRequests;
  assert(report.blockedDuringTest > 0, "Known advertising requests were not blocked.");
  report.cacheExists = fs.existsSync(path.join(process.env.MINOVA_USER_DATA_PATH || "", "adblock-engine.bin"));
  assert(report.cacheExists, "The compiled filter engine was not cached locally.");
  report.disabled = await evaluate(shell, `window.minova.setSettings({ adBlockEnabled: false }).then(() => window.minova.getAdBlockState())`);
  assert(!report.disabled.enabled, "Turning off ad blocking did not detach the blocker from the browser session.");
  report.reenabled = await evaluate(shell, `window.minova.setSettings({ adBlockEnabled: true }).then(() => window.minova.getAdBlockState())`);
  assert(report.reenabled.enabled, "Turning ad blocking back on did not reattach the blocker.");
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  save();
  await evaluate(shell, "window.minova.closeWindow(); true").catch(() => {});
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
