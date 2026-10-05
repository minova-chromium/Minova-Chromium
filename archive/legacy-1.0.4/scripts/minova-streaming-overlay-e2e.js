const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10157);
const holdOpen = process.argv.includes("--hold");
const classicLayout = process.argv.includes("--classic");
const safariLayout = process.argv.includes("--safari");
const windowedMode = process.argv.includes("--windowed");
const targetUrl = process.argv.find((argument) => /^https:\/\//i.test(argument)) || "https://example.com/";
const reportPath = path.join(__dirname, "artifacts", `streaming-overlay-${port}.json`);
const requestedLayout = safariLayout ? "safari" : classicLayout ? "classic" : "workspaces";
const report = { port, layout: requestedLayout, startedAt: new Date().toISOString() };

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
  for (let attempt = 0; attempt < 80; attempt += 1) {
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

async function waitForExpression(target, expression, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(target, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function main() {
  save();
  const shell = await findShell();
  await evaluate(shell, `(async () => {
    const maximized = await window.minova.isWindowMaximized();
    if (${JSON.stringify(windowedMode)} && maximized) {
      await window.minova.toggleMaximizeWindow();
    } else if (!${JSON.stringify(windowedMode)} && !maximized) {
      await window.minova.toggleMaximizeWindow();
    }
    return true;
  })()`);
  await waitForExpression(
    shell,
    "(async () => { const state = await window.minova.getBrowserWorkspaceState(); return state.contentSize[0] > 0 && state.contentSize[1] > 0; })()",
    "a visible Minova content area"
  );
  const sourceTabId = await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({
      tabLayout: ${JSON.stringify(requestedLayout)}
    });
    state.sidebarCollapsed = false;
    applyInterfaceLayout();
    persistSession();
    return openTab(${JSON.stringify(targetUrl)}).id;
  })()`);
  await waitForExpression(
    shell,
    `Boolean(state.tabs.find((tab) => tab.id === ${JSON.stringify(sourceTabId)})?.nativeWebContentsId)
      && state.tabs.find((tab) => tab.id === ${JSON.stringify(sourceTabId)})?.loading === false`,
    "the streaming source tab"
  );
  report.before = await evaluate(shell, `(async () => ({
    sidebarCollapsed: state.sidebarCollapsed,
    tabLayout: state.settings.tabLayout,
    workspace: await window.minova.getBrowserWorkspaceState()
  }))()`);
  report.started = await evaluate(shell, `(async () => {
    const result = await openActiveInStreamingMode();
    const streaming = await window.minova.getStreamingModeState();
    return {
      result,
      streaming,
      sidebarCollapsed: state.sidebarCollapsed,
      tabLayout: state.settings.tabLayout,
      workspace: await window.minova.getBrowserWorkspaceState(),
      toolbar: (() => {
        const bounds = document.querySelector(".toolbar").getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, height: bounds.height };
      })(),
      exitVisible: !document.querySelector("#exitStreamingModeButton").classList.contains("hidden"),
      backVisible: !document.querySelector("#backButton").classList.contains("hidden"),
      backEnabled: !document.querySelector("#backButton").disabled,
      backCommandAvailable: typeof window.minova.controlStreamingMode === "function",
      omniboxReadOnly: document.querySelector("#omnibox").readOnly,
      shellBuild: new URL(location.href).searchParams.get("build")
    };
  })()`, 40000);
  save();

  assert(report.started.result?.presentation === "overlay", `Streaming Mode did not start in overlay presentation: ${report.started.streaming.error || "unknown error"}`);
  assert(report.started.streaming.active && !report.started.streaming.starting, "Streaming overlay did not become active.");
  assert(report.started.streaming.interactive, "Streaming Mode did not attach keyboard and mouse focus to the embedded webpage.");
  assert(report.started.exitVisible && report.started.backVisible, "Exit Streaming and Back are not both visible in the top-left.");
  assert(report.started.backEnabled && report.started.backCommandAvailable, "Streaming Back is not connected to Edge navigation.");
  assert(report.started.omniboxReadOnly, "The Minova omnibox remained editable over the Edge streaming surface.");
  if (classicLayout || safariLayout) {
    const layoutName = safariLayout ? "Safari" : "Classic";
    const expectedToolbarTop = safariLayout ? 0 : 42;
    const expectedCaptureHeight = safariLayout ? 102 : 60;
    assert(report.started.tabLayout === requestedLayout, `${layoutName} layout changed while Streaming Mode started.`);
    assert(report.started.workspace.sidebarWidth === 0, `${layoutName} Streaming Mode reserved a phantom sidebar.`);
    assert(report.started.workspace.chromeHeight === 102, `${layoutName} Streaming Mode used the wrong chrome height.`);
    assert(report.started.workspace.toolbarHeight === expectedCaptureHeight, `${layoutName} Streaming Mode used the wrong toolbar capture height.`);
    assert(report.started.toolbar.left === 0 && report.started.toolbar.top === expectedToolbarTop, `${layoutName} toolbar is not aligned with its tab row.`);
  } else {
    assert(report.before.sidebarCollapsed === false, "The workspace sidebar was not expanded before the collapse test.");
    assert(report.started.sidebarCollapsed === true, "Streaming Mode did not collapse the workspace sidebar first.");
    assert(report.started.workspace.sidebarWidth === 60, "Streaming Mode did not wait for the collapsed sidebar geometry.");
    assert(report.started.workspace.chromeHeight === 102, "Workspace Streaming Mode used the wrong chrome height.");
    assert(report.started.toolbar.left === 60 && report.started.toolbar.top === 42, "Collapsed workspace toolbar is not aligned.");
    report.collapseLock = await evaluate(shell, `(() => {
      document.querySelector("#toggleSidebarButton").click();
      return {
        collapsed: state.sidebarCollapsed,
        shellCollapsed: document.querySelector(".app-shell").classList.contains("sidebar-collapsed")
      };
    })()`);
    assert(report.collapseLock.collapsed && report.collapseLock.shellCollapsed, "The workspace sidebar expanded while Streaming Mode was active.");
  }

  if (windowedMode) {
    const initialWidth = report.started.streaming.bounds.width;
    await evaluate(shell, "window.minova.toggleMaximizeWindow()");
    await waitForExpression(
      shell,
      `(async () => (await window.minova.getStreamingModeState()).bounds?.width !== ${initialWidth})()`,
      "the streaming overlay to follow maximize"
    );
    report.maximized = await evaluate(shell, `(async () => ({
      streaming: await window.minova.getStreamingModeState(),
      workspace: await window.minova.getBrowserWorkspaceState()
    }))()`);
    assert(report.maximized.streaming.active, "Streaming Mode stopped during maximize.");
    assert(
      report.maximized.streaming.bounds.width
        === report.maximized.workspace.contentSize[0] - report.maximized.workspace.sidebarWidth,
      "The streaming overlay width did not follow the maximized Minova content area."
    );

    const maximizedWidth = report.maximized.streaming.bounds.width;
    await evaluate(shell, "window.minova.toggleMaximizeWindow()");
    await waitForExpression(
      shell,
      `(async () => (await window.minova.getStreamingModeState()).bounds?.width !== ${maximizedWidth})()`,
      "the streaming overlay to follow restore"
    );
    report.restored = await evaluate(shell, `(async () => ({
      streaming: await window.minova.getStreamingModeState(),
      workspace: await window.minova.getBrowserWorkspaceState()
    }))()`);
    assert(report.restored.streaming.active, "Streaming Mode stopped during restore.");
    assert(
      report.restored.streaming.bounds.width
        === report.restored.workspace.contentSize[0] - report.restored.workspace.sidebarWidth,
      "The streaming overlay width did not follow the restored Minova content area."
    );
  }

  const backgroundTabId = await evaluate(shell, `openTab("minova://newtab").id`);
  await waitForExpression(
    shell,
    `(async () => {
      const streaming = await window.minova.getStreamingModeState();
      return streaming.active && streaming.backgrounded && state.activeTabId === ${JSON.stringify(backgroundTabId)};
    })()`,
    "Streaming Mode to pause behind another tab"
  );
  report.backgrounded = await evaluate(shell, `(async () => ({
    streaming: await window.minova.getStreamingModeState(),
    activeTabId: state.activeTabId,
    resumeVisible: !document.querySelector("#resumeStreamingModeButton").classList.contains("hidden"),
    exitHidden: document.querySelector("#exitStreamingModeButton").classList.contains("hidden"),
    omniboxReadOnly: document.querySelector("#omnibox").readOnly
  }))()`);
  assert(report.backgrounded.streaming.active, "Switching tabs closed Streaming Mode.");
  assert(report.backgrounded.streaming.backgrounded, "Streaming Mode did not enter its background state.");
  assert(report.backgrounded.resumeVisible && report.backgrounded.exitHidden, "The background Streaming indicator did not replace the foreground Exit control.");
  assert(!report.backgrounded.omniboxReadOnly, "The background tab's omnibox remained locked by Streaming Mode.");

  await evaluate(shell, `document.querySelector("#resumeStreamingModeButton").click(); true`);
  await waitForExpression(
    shell,
    `(async () => {
      const streaming = await window.minova.getStreamingModeState();
      return streaming.active
        && !streaming.backgrounded
        && streaming.interactive
        && state.activeTabId === ${JSON.stringify(sourceTabId)};
    })()`,
    "the original Streaming Mode tab to resume"
  );
  report.resumed = await evaluate(shell, `(async () => ({
    streaming: await window.minova.getStreamingModeState(),
    activeTabId: state.activeTabId,
    exitVisible: !document.querySelector("#exitStreamingModeButton").classList.contains("hidden"),
    omniboxReadOnly: document.querySelector("#omnibox").readOnly
  }))()`);
  assert(report.resumed.streaming.active && !report.resumed.streaming.backgrounded, "Streaming Mode did not resume its existing session.");
  assert(report.resumed.activeTabId === sourceTabId, "Resume Streaming did not reactivate its source tab.");
  assert(report.resumed.exitVisible && report.resumed.omniboxReadOnly, "The foreground Streaming toolbar was not restored.");

  if (holdOpen) {
    report.holding = true;
    save();
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  await evaluate(shell, `document.querySelector("#exitStreamingModeButton").click(); true`);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await evaluate(shell, `window.minova.getStreamingModeState()`);
    if (!state.active && !state.starting) {
      report.stopped = state;
      break;
    }
    await sleep(100);
  }
  assert(report.stopped, "Exit Streaming did not close the attached Edge window.");
  assert(!report.stopped.error, `Streaming Mode reported an exit error: ${report.stopped.error}`);
  report.uiAfterExit = await evaluate(shell, `({
    exitHidden: document.querySelector("#exitStreamingModeButton").classList.contains("hidden"),
    backVisible: !document.querySelector("#backButton").classList.contains("hidden"),
    omniboxReadOnly: document.querySelector("#omnibox").readOnly
  })`);
  assert(report.uiAfterExit.exitHidden && report.uiAfterExit.backVisible && !report.uiAfterExit.omniboxReadOnly, "Minova's toolbar did not restore after Streaming Mode exited.");

  await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({ tabLayout: "workspaces" });
    state.sidebarCollapsed = false;
    applyInterfaceLayout();
    persistSession();
    closeTab(${JSON.stringify(sourceTabId)});
    return true;
  })()`);

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
