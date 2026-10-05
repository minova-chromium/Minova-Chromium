const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10068);
const reportPath = path.join(__dirname, "artifacts", `shutdown-${port}.json`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findShell() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const shell = (await targets()).find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // The debugging endpoint may not be ready yet.
    }
    await sleep(250);
  }
  throw new Error("Minova shell target was not found.");
}

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Runtime.evaluate timed out."));
    }, 12000);
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

async function main() {
  save();
  const shell = await findShell();
  report.beforeClose = await evaluate(shell, `({
    build: new URL(location.href).searchParams.get("build"),
    tabs: state.tabs.length,
    activeUrl: getActiveTab()?.url || ""
  })`);
  await evaluate(shell, "window.minova.closeWindow(); true");

  let endpointClosed = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    try {
      await targets();
    } catch {
      endpointClosed = true;
      break;
    }
  }
  report.endpointClosed = endpointClosed;
  report.passed = endpointClosed;
  report.finishedAt = new Date().toISOString();
  save();
  if (!endpointClosed) throw new Error("Minova did not exit after its main window closed.");
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
