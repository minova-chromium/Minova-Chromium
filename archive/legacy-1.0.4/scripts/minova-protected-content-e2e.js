const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10125);
const reportPath = path.join(__dirname, "artifacts", `protected-content-${port}.json`);
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
      reject(new Error(`${method} timed out`));
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

async function findShell() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const shell = (await targets()).find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // First-run component installation can delay browser-window creation.
    }
    await sleep(500);
  }
  throw new Error("Minova shell was not created after protected-content initialization");
}

async function main() {
  save();
  const shell = await findShell();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)")) break;
    await sleep(250);
  }
  assert(
    await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)"),
    "Minova did not finish initializing before the protected-content test"
  );
  const version = await evaluate(shell, "window.minova.getVersion()");
  const tabId = await evaluate(shell, `openTab("https://example.com/").id`);
  await evaluate(shell, `state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.nativeReady || false`, 30000);
  let status;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    status = await evaluate(shell, `window.minova.getProtectedContentStatus(${JSON.stringify(tabId)})`, 30000);
    if (status.eme?.secureContext && (status.eme.supported || status.eme.error)) break;
    await sleep(500);
  }

  report.version = version;
  report.status = status;
  report.summary = {
    runtime: status.runtime,
    componentVersion: status.version,
    libraryCount: status.files?.libraries?.length || 0,
    manifestCount: status.files?.manifests?.length || 0,
    emeSupported: status.eme?.supported,
    secureContext: status.eme?.secureContext,
    userAgent: status.eme?.userAgent,
    pluginNames: status.eme?.plugins || []
  };

  assert(status.runtime === "ecs", "Minova is not running Electron for Content Security");
  assert(status.initialized && status.ready, `Widevine component is not ready: ${JSON.stringify(status.errors)}`);
  assert(Boolean(status.version), "Widevine component did not report a version");
  assert(report.summary.libraryCount > 0, "The installed Widevine CDM library was not found in Minova's runtime or user-data paths");
  assert(report.summary.manifestCount > 0, "The installed Widevine manifest was not found next to the CDM library");
  assert(status.eme?.secureContext && status.eme?.supported, `Widevine EME probe failed: ${status.eme?.error || "unknown error"}`);
  assert(!/Electron\/|Minova\//i.test(status.eme.userAgent), "The browsing user agent exposes a custom Electron or Minova token");
  assert(/Chrome\//i.test(status.eme.userAgent), "The browsing user agent does not identify as Chrome");

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
