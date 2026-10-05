"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.argv[2] || 10317);
const workspaceEditorScreenshot = path.join(
  __dirname,
  "artifacts",
  `workspace-editor-${port}.png`
);
const classicLayoutScreenshot = path.join(
  __dirname,
  "artifacts",
  `classic-layout-${port}.png`
);
const safariLayoutScreenshot = path.join(
  __dirname,
  "artifacts",
  `safari-layout-${port}.png`
);
const safariLightLayoutScreenshot = path.join(
  __dirname,
  "artifacts",
  `safari-light-layout-${port}.png`
);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForTarget(predicate, description, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForNoTarget(predicate, description, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!(await listTargets()).some(predicate)) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function command(target, method, params = {}, timeoutMilliseconds = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMilliseconds);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const details = message.result?.exceptionDetails;
        reject(new Error(
          details?.exception?.description
          || details?.text
          || message.error?.message
          || "Unknown DevTools error"
        ));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMilliseconds) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMilliseconds);
  return result.result.value;
}

async function waitForExpression(target, expression, description, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(target, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function startFixture() {
  const server = http.createServer((request, response) => {
    const label = request.url.includes("alpha") ? "Alpha Pane" : "Beta Pane";
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    });
    response.end(`<!doctype html>
      <html>
        <head><title>${label}</title></head>
        <body style="margin:0;background:#101822;color:white"><h1>${label}</h1></body>
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

function expectedPaneBounds(state, paneIndex, paneCount) {
  const [windowWidth, windowHeight] = state.contentSize;
  const availableWidth = windowWidth - state.sidebarWidth;
  const totalGap = paneCount > 1 ? state.splitGap * (paneCount - 1) : 0;
  const paneWidth = Math.floor((availableWidth - totalGap) / paneCount);
  const x = state.sidebarWidth + paneIndex * (paneWidth + state.splitGap);
  return {
    x,
    y: state.chromeHeight,
    width: paneIndex === paneCount - 1 ? windowWidth - x : paneWidth,
    height: windowHeight - state.chromeHeight
  };
}

(async () => {
  const fixture = await startFixture();
  let shell;
  let alphaTabId = "";
  let betaTabId = "";
  let originalMaximized = null;

  try {
    shell = await waitForTarget(
      (target) => target.url.includes("/src/index.html"),
      "the Minova shell"
    );
    await waitForExpression(
      shell,
      "Boolean(window.minova?.getBrowserWorkspaceState && document.querySelector('#workspaceList'))",
      "the workspace UI and diagnostics bridge"
    );

    const sidebarUi = await evaluate(shell, `({
      workspaceCount: document.querySelectorAll(".workspace-button").length,
      collapsed: document.querySelector(".app-shell").classList.contains("sidebar-collapsed"),
      splitControl: Boolean(document.querySelector("#splitViewButton")),
      tabList: Boolean(document.querySelector("#tabStrip"))
    })`);
    assert.deepEqual(sidebarUi, {
      workspaceCount: 3,
      collapsed: false,
      splitControl: true,
      tabList: true
    });

    alphaTabId = await evaluate(shell, `openTab(${JSON.stringify(`${fixture.url}alpha`)}).id`);
    await waitForExpression(
      shell,
      `Boolean(state.tabs.find((tab) => tab.id === ${JSON.stringify(alphaTabId)})?.nativeWebContentsId)
        && state.tabs.find((tab) => tab.id === ${JSON.stringify(alphaTabId)})?.loading === false`,
      "the first native tab"
    );

    betaTabId = await evaluate(shell, `openTab(${JSON.stringify(`${fixture.url}beta`)}).id`);
    await waitForExpression(
      shell,
      `Boolean(state.tabs.find((tab) => tab.id === ${JSON.stringify(betaTabId)})?.nativeWebContentsId)
        && state.tabs.find((tab) => tab.id === ${JSON.stringify(betaTabId)})?.loading === false`,
      "the second native tab"
    );

    let workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, [betaTabId]);
    assert.equal(workspaceState.sidebarWidth, 272);
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 1));

    await evaluate(shell, "openWorkspaceDialog(); true");
    const workspaceEditor = await waitForTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the native workspace editor above the webpage"
    );
    await waitForExpression(
      workspaceEditor,
      "Boolean(document.querySelector('#dialogTitle') && document.querySelector('#workspaceName'))",
      "the workspace editor form"
    );
    const editorUi = await evaluate(workspaceEditor, `({
      title: document.querySelector("#dialogTitle").textContent,
      focused: document.activeElement?.id,
      createLabel: document.querySelector("#saveButton").textContent,
      deleteHidden: document.querySelector("#deleteButton").classList.contains("hidden"),
      footerFits: document.querySelector("footer").getBoundingClientRect().bottom <= innerHeight
    })`);
    assert.deepEqual(editorUi, {
      title: "New workspace",
      focused: "workspaceName",
      createLabel: "Create",
      deleteHidden: true,
      footerFits: true
    });
    const editorScreenshot = await command(workspaceEditor, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.mkdirSync(path.dirname(workspaceEditorScreenshot), { recursive: true });
    fs.writeFileSync(workspaceEditorScreenshot, Buffer.from(editorScreenshot.data, "base64"));
    await evaluate(workspaceEditor, "window.minovaWorkspace.cancel(); true");
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the workspace editor to close"
    );

    await evaluate(shell, "openWorkspaceDialog(); true");
    const createEditor = await waitForTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the workspace creation editor"
    );
    await waitForExpression(
      createEditor,
      "Boolean(document.querySelector('#workspaceName') && document.querySelector('#workspaceForm'))",
      "the workspace creation form"
    );
    await evaluate(createEditor, `(() => {
      document.querySelector("#workspaceName").value = "E2E Space";
      document.querySelector("#workspaceColor").value = "#4d8dff";
      document.querySelector("#workspaceForm").requestSubmit();
      return true;
    })()`);
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the workspace creation editor to close"
    );
    await waitForExpression(
      shell,
      "Boolean(getWorkspace('e2e-space')) && state.activeWorkspaceId === 'e2e-space'",
      "the newly created workspace"
    );
    assert.deepEqual(await evaluate(shell, `({
      name: getWorkspace("e2e-space").name,
      color: getWorkspace("e2e-space").color,
      tabCount: getWorkspaceTabs("e2e-space").length
    })`), {
      name: "E2E Space",
      color: "#4d8dff",
      tabCount: 1
    });

    await evaluate(shell, "openWorkspaceDialog('e2e-space'); true");
    const editEditor = await waitForTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the workspace editing dialog"
    );
    await waitForExpression(
      editEditor,
      "document.querySelector('#dialogTitle')?.textContent === 'Edit workspace'",
      "the workspace editing form"
    );
    assert.deepEqual(await evaluate(editEditor, `({
      name: document.querySelector("#workspaceName").value,
      color: document.querySelector("#workspaceColor").value,
      deleteVisible: !document.querySelector("#deleteButton").classList.contains("hidden")
    })`), {
      name: "E2E Space",
      color: "#4d8dff",
      deleteVisible: true
    });
    await evaluate(editEditor, `(() => {
      document.querySelector("#deleteButton").click();
      document.querySelector("#deleteButton").click();
      return true;
    })()`);
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the workspace editing dialog to close"
    );
    await waitForExpression(
      shell,
      "!getWorkspace('e2e-space')",
      "the test workspace to be removed"
    );

    await evaluate(shell, "openWorkspaceDialog('gaming'); true");
    const starterWorkspaceEditor = await waitForTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the built-in Gaming workspace editor"
    );
    await waitForExpression(
      starterWorkspaceEditor,
      "document.querySelector('#workspaceName')?.value === 'Gaming'",
      "the built-in workspace customization form"
    );
    assert.equal(
      await evaluate(
        starterWorkspaceEditor,
        "!document.querySelector('#deleteButton').classList.contains('hidden')"
      ),
      true
    );
    await evaluate(starterWorkspaceEditor, `(() => {
      document.querySelector("#deleteButton").click();
      document.querySelector("#deleteButton").click();
      return true;
    })()`);
    await waitForNoTarget(
      (target) => target.url.endsWith("/src/workspace-editor.html"),
      "the built-in workspace editor to close"
    );
    await waitForExpression(shell, "!getWorkspace('gaming')", "the Gaming workspace to be removed");
    assert.equal(await evaluate(shell, "state.workspaces.length === 2"), true);
    await evaluate(shell, `applyWorkspaceEditorSave("", "Gaming", "#ef6f9a"); true`);
    await waitForExpression(shell, "Boolean(getWorkspace('gaming'))", "the Gaming workspace to be restored");

    await evaluate(shell, `activateTab(${JSON.stringify(betaTabId)}); true`);
    await waitForExpression(
      shell,
      `(async () => (await window.minova.getBrowserWorkspaceState()).visibleTabIds[0] === ${JSON.stringify(betaTabId)})()`,
      "the original webpage after workspace editing"
    );

    await evaluate(shell, "toggleSplitView()");
    await waitForExpression(
      shell,
      "(async () => (await window.minova.getBrowserWorkspaceState()).visibleTabIds.length === 2)()",
      "two visible split-view panes"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, [betaTabId, alphaTabId]);
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 2));
    assert.deepEqual(workspaceState.boundsByTabId[alphaTabId], expectedPaneBounds(workspaceState, 1, 2));
    const streamingGuard = await evaluate(shell, `(async () => {
      const button = document.querySelector("#streamingModeButton");
      try {
        await window.minova.openStreamingMode(
          ${JSON.stringify(betaTabId)},
          ${JSON.stringify(`${fixture.url}beta`)}
        );
        return { rejected: false, message: "", buttonDisabled: button.disabled, title: button.title };
      } catch (error) {
        return {
          rejected: true,
          message: error.message,
          buttonDisabled: button.disabled,
          title: button.title
        };
      }
    })()`);
    assert.equal(streamingGuard.rejected, true);
    assert.match(streamingGuard.message, /Exit Split View before entering Streaming Mode\./);
    assert.equal(streamingGuard.buttonDisabled, true);
    assert.equal(streamingGuard.title, "Exit Split View to use Streaming Mode");

    originalMaximized = await evaluate(shell, "window.minova.isWindowMaximized()");
    const previousContentSize = workspaceState.contentSize.join("x");
    await evaluate(shell, "window.minova.toggleMaximizeWindow()");
    await waitForExpression(
      shell,
      `(async () => (await window.minova.getBrowserWorkspaceState()).contentSize.join("x") !== ${JSON.stringify(previousContentSize)})()`,
      "split-view bounds to react to window resize"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 2));
    assert.deepEqual(workspaceState.boundsByTabId[alphaTabId], expectedPaneBounds(workspaceState, 1, 2));

    await evaluate(shell, "document.querySelector('#toggleSidebarButton').click(); true");
    await waitForExpression(
      shell,
      "(async () => (await window.minova.getBrowserWorkspaceState()).sidebarWidth === 60)()",
      "the collapsed sidebar layout"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 2));
    assert.deepEqual(workspaceState.boundsByTabId[alphaTabId], expectedPaneBounds(workspaceState, 1, 2));

    await evaluate(shell, "switchWorkspace('work'); true");
    await waitForExpression(
      shell,
      "(async () => (await window.minova.getBrowserWorkspaceState()).activeWorkspaceId === 'work')()",
      "the Work workspace"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, []);
    assert.equal(
      workspaceState.tabs.filter((tab) => tab.workspaceId === "personal").length >= 2,
      true
    );

    await evaluate(shell, "switchWorkspace('personal'); true");
    await waitForExpression(
      shell,
      "(async () => {"
        + " const current = await window.minova.getBrowserWorkspaceState();"
        + " return current.activeWorkspaceId === 'personal' && current.visibleTabIds.length === 2;"
        + " })()",
      "the restored Personal split view"
    );

    await evaluate(shell, `closeTab(${JSON.stringify(alphaTabId)}); true`);
    alphaTabId = "";
    await waitForExpression(
      shell,
      "(async () => (await window.minova.getBrowserWorkspaceState()).visibleTabIds.length === 1)()",
      "split view to collapse after closing one pane"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, [betaTabId]);
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 1));

    await evaluate(shell, `(() => {
      renderSettings("appearance");
      const control = document.querySelector('[data-setting="tabLayout"]');
      control.value = "classic";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(
      shell,
      "(async () => {"
        + " const current = await window.minova.getBrowserWorkspaceState();"
        + " return current.sidebarWidth === 0 && current.chromeHeight === 102;"
        + " })()",
      "the classic horizontal tab layout"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, [betaTabId]);
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 1));
    const classicUi = await evaluate(shell, `(() => {
      const tabs = [...document.querySelectorAll("#tabStrip .tab")];
      const lastTabBounds = tabs.at(-1).getBoundingClientRect();
      const newTabBounds = document.querySelector("#newTabButton").getBoundingClientRect();
      const controls = [...document.querySelectorAll(".window-control")];
      const windowControlsHit = controls.every((control) => {
        const bounds = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2
        );
        return control === hit || control.contains(hit);
      });
      return {
        classic: document.querySelector(".app-shell").classList.contains("classic-ui"),
        sidebarHeight: Math.round(document.querySelector("#sidebar").getBoundingClientRect().height),
        toolbarTop: Math.round(document.querySelector(".toolbar").getBoundingClientRect().top),
        tabTop: Math.round(document.querySelector("#tabStrip").getBoundingClientRect().top),
        controlsTop: Math.round(document.querySelector(".window-controls").getBoundingClientRect().top),
        direction: getComputedStyle(document.querySelector("#tabStrip")).flexDirection,
        workspaceListHidden: getComputedStyle(document.querySelector("#workspaceList")).display === "none",
        renderedTabs: tabs.length,
        totalTabs: state.tabs.length,
        newTabGap: Math.round(newTabBounds.left - lastTabBounds.right),
        windowControlsHit
      };
    })()`);
    const { newTabGap, windowControlsHit, ...classicLayout } = classicUi;
    assert.deepEqual(classicLayout, {
      classic: true,
      sidebarHeight: 42,
      toolbarTop: 42,
      tabTop: 4,
      controlsTop: 0,
      direction: "row",
      workspaceListHidden: true,
      renderedTabs: classicLayout.totalTabs,
      totalTabs: classicLayout.totalTabs
    });
    assert(newTabGap >= 0 && newTabGap <= 8, `The Classic new-tab button is ${newTabGap}px from the final tab.`);
    assert.equal(windowControlsHit, true, "The Classic window controls are not pointer targets.");

    const maximizedBeforeControlClick = await evaluate(shell, "window.minova.isWindowMaximized()");
    await evaluate(shell, "document.querySelector('#maximizeWindowButton').click(); true");
    await waitForExpression(
      shell,
      `window.minova.isWindowMaximized().then((value) => value === ${JSON.stringify(!maximizedBeforeControlClick)})`,
      "the Classic maximize/restore control"
    );
    await evaluate(shell, "document.querySelector('#maximizeWindowButton').click(); true");
    await waitForExpression(
      shell,
      `window.minova.isWindowMaximized().then((value) => value === ${JSON.stringify(maximizedBeforeControlClick)})`,
      "the Classic window state to be restored"
    );
    const classicScreenshot = await command(shell, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.mkdirSync(path.dirname(classicLayoutScreenshot), { recursive: true });
    fs.writeFileSync(classicLayoutScreenshot, Buffer.from(classicScreenshot.data, "base64"));
    await evaluate(shell, "toggleSplitView(); true");
    assert.deepEqual(
      await evaluate(shell, "getActiveWorkspace().splitTabIds"),
      []
    );

    await evaluate(shell, `(() => {
      const control = document.querySelector('[data-setting="tabLayout"]');
      control.value = "safari";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(
      shell,
      "(async () => {"
        + " const current = await window.minova.getBrowserWorkspaceState();"
        + " return current.sidebarWidth === 0 && current.chromeHeight === 102 && current.toolbarHeight === 102;"
        + " })()",
      "the Safari-style tab layout"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.visibleTabIds, [betaTabId]);
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 1));
    const safariUi = await evaluate(shell, `(() => {
      const tabs = [...document.querySelectorAll("#tabStrip .tab")];
      const lastTabBounds = tabs.at(-1).getBoundingClientRect();
      const newTabBounds = document.querySelector("#newTabButton").getBoundingClientRect();
      const controls = [...document.querySelectorAll(".window-control")];
      const controlBounds = Object.fromEntries(controls.map((control) => [
        control.classList.contains("close") ? "close" : control.classList.contains("minimize") ? "minimize" : "maximize",
        control.getBoundingClientRect().left
      ]));
      const windowControlsHit = controls.every((control) => {
        const bounds = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2
        );
        return control === hit || control.contains(hit);
      });
      const omnibox = document.querySelector(".omnibox-wrap");
      const omniboxBounds = omnibox.getBoundingClientRect();
      return {
        safari: document.querySelector(".app-shell").classList.contains("safari-ui"),
        classic: document.querySelector(".app-shell").classList.contains("classic-ui"),
        sidebarHeight: Math.round(document.querySelector("#sidebar").getBoundingClientRect().height),
        toolbarTop: Math.round(document.querySelector(".toolbar").getBoundingClientRect().top),
        tabTop: Math.round(document.querySelector("#tabStrip").getBoundingClientRect().top),
        controlsTop: Math.round(document.querySelector(".window-controls").getBoundingClientRect().top),
        controlsLeft: Math.round(document.querySelector(".window-controls").getBoundingClientRect().left),
        trafficOrder: controlBounds.close < controlBounds.minimize && controlBounds.minimize < controlBounds.maximize,
        direction: getComputedStyle(document.querySelector("#tabStrip")).flexDirection,
        workspaceListHidden: getComputedStyle(document.querySelector("#workspaceList")).display === "none",
        renderedTabs: tabs.length,
        totalTabs: state.tabs.length,
        newTabGap: Math.round(newTabBounds.left - lastTabBounds.right),
        omniboxRadius: Math.round(parseFloat(getComputedStyle(omnibox).borderRadius)),
        omniboxWidth: Math.round(omniboxBounds.width),
        windowControlsHit
      };
    })()`);
    const {
      newTabGap: safariNewTabGap,
      omniboxWidth,
      windowControlsHit: safariWindowControlsHit,
      ...safariLayout
    } = safariUi;
    assert.deepEqual(safariLayout, {
      safari: true,
      classic: false,
      sidebarHeight: 42,
      toolbarTop: 0,
      tabTop: 64,
      controlsTop: 0,
      controlsLeft: 8,
      trafficOrder: true,
      direction: "row",
      workspaceListHidden: true,
      renderedTabs: safariLayout.totalTabs,
      totalTabs: safariLayout.totalTabs,
      omniboxRadius: 10
    });
    assert(safariNewTabGap >= 0 && safariNewTabGap <= 8, `The Safari new-tab button is ${safariNewTabGap}px from the final tab.`);
    assert(omniboxWidth >= 200 && omniboxWidth <= 680, `The Safari Smart Search field is ${omniboxWidth}px wide.`);
    assert.equal(safariWindowControlsHit, true, "The Safari traffic-light controls are not pointer targets.");
    await sleep(3500);
    const safariScreenshot = await command(shell, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.mkdirSync(path.dirname(safariLayoutScreenshot), { recursive: true });
    fs.writeFileSync(safariLayoutScreenshot, Buffer.from(safariScreenshot.data, "base64"));
    const safariLightPalette = await evaluate(shell, `(async () => {
      state.settings = await window.minova.setSettings({ theme: "light" });
      applyTheme();
      const styles = getComputedStyle(document.querySelector(".app-shell"));
      return {
        background: styles.getPropertyValue("--bg").trim(),
        panel: styles.getPropertyValue("--panel").trim(),
        text: styles.getPropertyValue("--text").trim()
      };
    })()`);
    assert.deepEqual(safariLightPalette, {
      background: "#c7ccd3",
      panel: "#d2d6dc",
      text: "#1d2530"
    });
    const safariLightScreenshot = await command(shell, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.writeFileSync(safariLightLayoutScreenshot, Buffer.from(safariLightScreenshot.data, "base64"));
    await evaluate(shell, `(async () => {
      state.settings = await window.minova.setSettings({ theme: "dark" });
      applyTheme();
      return true;
    })()`);
    await evaluate(shell, "toggleSplitView(); true");
    assert.deepEqual(await evaluate(shell, "getActiveWorkspace().splitTabIds"), []);

    await evaluate(shell, `(() => {
      const control = document.querySelector('[data-setting="tabLayout"]');
      control.value = "workspaces";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(
      shell,
      "(async () => {"
        + " const current = await window.minova.getBrowserWorkspaceState();"
        + " return current.sidebarWidth === 60 && current.chromeHeight === 102;"
        + " })()",
      "the restored workspace sidebar layout"
    );
    workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
    assert.deepEqual(workspaceState.boundsByTabId[betaTabId], expectedPaneBounds(workspaceState, 0, 1));

    console.log(JSON.stringify({
      passed: true,
      verticalSidebar: sidebarUi,
      nativeWorkspaceEditor: true,
      workspaceEditorScreenshot,
      workspaceCreateEditDelete: true,
      starterWorkspaceDeletion: true,
      splitView: true,
      streamingBlockedDuringSplitView: true,
      resized: true,
      collapsedSidebar: true,
      workspaceSwitching: true,
      classicLayout: classicUi,
      classicLayoutScreenshot,
      safariLayout: safariUi,
      safariLayoutScreenshot,
      safariLightPalette,
      safariLightLayoutScreenshot,
      layoutSwitching: true,
      closePaneLifecycle: true,
      finalBounds: workspaceState.boundsByTabId[betaTabId]
    }, null, 2));
  } finally {
    if (shell) {
      await evaluate(shell, `
        (async () => {
          if (getWorkspace("e2e-space")) removeWorkspace("e2e-space");
          if (!getWorkspace("gaming")) applyWorkspaceEditorSave("", "Gaming", "#ef6f9a");
          if (state.settings?.tabLayout !== "workspaces") {
            state.settings = await window.minova.setSettings({ tabLayout: "workspaces" });
            applyInterfaceLayout();
          }
          return true;
        })()
      `).catch(() => {});
      if (alphaTabId) {
        await evaluate(shell, `closeTab(${JSON.stringify(alphaTabId)}); true`).catch(() => {});
      }
      if (betaTabId) {
        await evaluate(shell, `closeTab(${JSON.stringify(betaTabId)}); true`).catch(() => {});
      }
      await evaluate(shell, `
        if (state.sidebarCollapsed) {
          state.sidebarCollapsed = false;
          applySidebarState();
          persistSession();
        }
        true
      `).catch(() => {});

      if (originalMaximized !== null) {
        const currentlyMaximized = await evaluate(shell, "window.minova.isWindowMaximized()").catch(() => null);
        if (currentlyMaximized !== null && currentlyMaximized !== originalMaximized) {
          await evaluate(shell, "window.minova.toggleMaximizeWindow()").catch(() => {});
        }
      }
    }
    await new Promise((resolve) => fixture.server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
