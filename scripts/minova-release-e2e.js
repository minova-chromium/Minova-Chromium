const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.argv[2] || 10241);
const expectedVersion = require("../package.json").version;
const reportPath = path.join(__dirname, "artifacts", `release-${port}.json`);
const screenshotPath = path.join(__dirname, "artifacts", `release-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
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
        reject(new Error(message.error?.message || message.result.exceptionDetails?.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMilliseconds = 20000) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMilliseconds);
  return result.result.value;
}

async function findShell() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const shell = targets.find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {
      // The debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error("Minova shell target was not found.");
}

async function waitFor(shell, expression, description) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(shell, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function startFixtureServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html lang="en">
        <head><title>Minova Release Fixture</title></head>
        <body>
          <h1>Minova release marker</h1>
          <p>Minova release marker appears twice for find-in-page testing.</p>
        </body>
      </html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/`
  };
}

async function main() {
  save();
  const fixture = await startFixtureServer();
  try {
    const shell = await findShell();
    report.contract = await evaluate(shell, `(async () => ({
      build: new URL(location.href).searchParams.get("build"),
      version: (await window.minova.getVersion()).minova,
      startupMode: (await window.minova.getSettings()).startupMode,
      tabListRole: document.querySelector("#tabStrip").getAttribute("role"),
      toolbarLabel: document.querySelector(".toolbar").getAttribute("aria-label"),
      findAvailable: typeof window.minova.findInBrowserTab === "function"
        && typeof window.minova.stopFindInBrowserTab === "function"
    }))()`);
    assert(report.contract.build === `minova-${expectedVersion}`, "The shell build does not match package.json.");
    assert(report.contract.version === expectedVersion, "The app version does not match package.json.");
    assert(report.contract.startupMode === "continue", "Session continuation is not the default startup mode.");
    assert(report.contract.tabListRole === "tablist" && report.contract.toolbarLabel, "Browser shell accessibility labels are missing.");
    assert(report.contract.findAvailable, "The find-in-page IPC bridge is incomplete.");

    report.fixtureTab = await evaluate(shell, `(() => {
      state.closedTabs = [];
      persistClosedTabs();
      const tab = openTab(${JSON.stringify(fixture.url)});
      return { id: tab.id, url: tab.url };
    })()`);
    await waitFor(
      shell,
      `getActiveTab()?.url === ${JSON.stringify(fixture.url)} && getActiveTab()?.loading === false`,
      "the release fixture page"
    );

    report.find = await evaluate(shell, `(async () => {
      openFindBar();
      findInput.value = "Minova release marker";
      await runFind(true, false);
      return { visible: !findBar.classList.contains("hidden"), query: findState.query };
    })()`);
    await waitFor(shell, "findState.matches >= 2", "find-in-page results");
    report.find.result = await evaluate(shell, `({
      matches: findState.matches,
      activeMatchOrdinal: findState.activeMatchOrdinal,
      output: findResult.textContent
    })`);
    assert(report.find.visible && report.find.result.matches >= 2, "Find in page did not return the expected matches.");
    await evaluate(shell, "closeFindBar()");

    report.reopen = await evaluate(shell, `(async () => {
      const fixtureId = getActiveTab().id;
      openTab("minova://newtab");
      closeTab(fixtureId);
      const closedCount = state.closedTabs.length;
      const reopened = reopenClosedTab();
      return {
        closedCount,
        reopenedUrl: reopened?.url || "",
        canReopenMore: state.closedTabs.length > 0
      };
    })()`);
    assert(report.reopen.closedCount === 1, "Closed tabs were not recorded.");
    assert(report.reopen.reopenedUrl === fixture.url, "The most recently closed tab was not reopened.");

    report.session = await evaluate(shell, `(() => {
      const privateTab = openTab("minova://newtab", { private: true });
      persistSession();
      const saved = JSON.parse(localStorage.getItem("minova:session"));
      closeTab(privateTab.id);
      showToast("Minova 1.0 release check", "success", 5000);
      return {
        tabCount: saved.tabs.length,
        includesFixture: saved.tabs.some((tab) => tab.url === ${JSON.stringify(fixture.url)}),
        containsPrivateTab: saved.tabs.some((tab) => tab.private),
        toastText: document.querySelector(".toast")?.textContent || "",
        selectedTabs: document.querySelectorAll('#tabStrip [role="tab"][aria-selected="true"]').length,
        selectedWorkspaces: document.querySelectorAll('#workspaceList [role="tab"][aria-selected="true"]').length
      };
    })()`);
    assert(report.session.includesFixture, "The regular browser session was not persisted.");
    assert(!report.session.containsPrivateTab, "A private tab leaked into the saved session.");
    assert(report.session.toastText === "Minova 1.0 release check", "Non-blocking browser feedback did not render.");
    assert(report.session.selectedTabs === 1, "The tab strip does not expose exactly one selected tab.");
    assert(report.session.selectedWorkspaces === 1, "The workspace list does not expose exactly one selected workspace.");

    const screenshot = await command(shell, "Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    report.screenshotPath = screenshotPath;
    report.passed = true;
    report.finishedAt = new Date().toISOString();
    save();
    process.stdout.write(JSON.stringify(report, null, 2));
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  process.exitCode = 1;
});
