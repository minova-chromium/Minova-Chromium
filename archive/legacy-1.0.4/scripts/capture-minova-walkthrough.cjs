"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const nodeRuntime = process.execPath;
const port = Number(process.env.MINOVA_CAPTURE_PORT || 10533);
const version = process.env.MINOVA_CAPTURE_VERSION || "1.0.3";
const outputDirectory = path.join(root, "showcase", `minova-${version}-walkthrough`);
const profile = path.join(outputDirectory, ".capture-profile");
const reportPath = path.join(outputDirectory, "manifest.json");
const packagedExecutable = process.env.MINOVA_CAPTURE_EXE
  || `C:\Users\DEVELOPER\\Documents\\Minova Browser\\dist\\update\\win-unpacked\\Minova.exe`;
const sourceExecutable = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const executable = fs.existsSync(packagedExecutable) ? packagedExecutable : sourceExecutable;
const packaged = path.resolve(executable) !== path.resolve(sourceExecutable);
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const windowCaptureScript = path.join(__dirname, "capture-minova-window.ps1");
const entries = [];
let appProcess = null;
let fixtureServer = null;
let sequence = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nextPath(title) {
  sequence += 1;
  return path.join(outputDirectory, `${String(sequence).padStart(2, "0")}-${slug(title)}.png`);
}

function register(title, category, destination, description) {
  const stats = fs.statSync(destination);
  entries.push({
    number: sequence,
    title,
    category,
    description,
    file: path.basename(destination),
    bytes: stats.size
  });
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForTarget(predicate, description, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target) return target;
    } catch {
      // The remote debugging endpoint may still be starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForNoTarget(predicate, description, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!(await listTargets()).some(predicate)) return;
    } catch {
      return;
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

async function waitForExpression(target, expression, description, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(target, expression)) return;
    } catch {
      // The renderer may be between navigation and first paint.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function captureTarget(target, title, category, description) {
  await sleep(220);
  const destination = nextPath(title);
  const result = await command(target, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(destination, Buffer.from(result.data, "base64"));
  register(title, category, destination, description);
  process.stdout.write(`Captured ${String(sequence).padStart(2, "0")}: ${title}\n`);
  return destination;
}

async function captureSplitView(shell, title, category, description) {
  const sharp = require("sharp");
  const workspaceState = await evaluate(shell, "window.minova.getBrowserWorkspaceState()");
  const paneDefinitions = await evaluate(shell, `(() => {
    const visible = new Set(${JSON.stringify([])});
    return state.tabs
      .filter((tab) => (getActiveWorkspace()?.splitTabIds || []).includes(tab.id))
      .map((tab) => ({ id: tab.id, url: tab.url }));
  })()`);
  const targets = await listTargets();
  const shellCapture = await command(shell, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const composites = [];

  for (const pane of paneDefinitions) {
    const bounds = workspaceState.boundsByTabId[pane.id];
    const target = targets.find((candidate) => candidate.url === pane.url);
    if (!bounds || !target) {
      throw new Error(`Could not locate the live Split View target for ${pane.url}.`);
    }
    const paneCapture = await command(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    const input = await sharp(Buffer.from(paneCapture.data, "base64"))
      .resize(bounds.width, bounds.height, { fit: "fill" })
      .png()
      .toBuffer();
    composites.push({
      input,
      left: bounds.x,
      top: bounds.y
    });
  }

  const destination = nextPath(title);
  await sharp(Buffer.from(shellCapture.data, "base64"))
    .composite(composites)
    .png()
    .toFile(destination);
  register(title, category, destination, description);
  process.stdout.write(`Captured ${String(sequence).padStart(2, "0")}: ${title}\n`);
  return destination;
}

function captureNativeWindow(title, category, description) {
  const destination = nextPath(title);
  const result = spawnSync(powershell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    windowCaptureScript,
    "-ProcessId",
    String(appProcess.pid),
    "-OutputPath",
    destination
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Native capture failed for ${title}.`);
  }
  register(title, category, destination, description);
  process.stdout.write(`Captured ${String(sequence).padStart(2, "0")}: ${title}\n`);
  return destination;
}

async function captureInstallerPreviews() {
  const { chromium } = require("playwright");
  const previewFile = path.join(root, "installer", "preview", "index.html");
  const browserCandidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ];
  const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("Microsoft Edge or Google Chrome is required for installer captures.");

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--force-device-scale-factor=1"]
  });

  const screens = [
    {
      title: "Installer - Ready to install",
      screen: "installer",
      width: 940,
      height: 620,
      description: "Installation location, shortcut choices, disk usage, and GPL licensing."
    },
    {
      title: "Installer - Preparing files",
      screen: "progress",
      progress: 7,
      width: 940,
      height: 620,
      description: "The first installation stage prepares the browser package."
    },
    {
      title: "Installer - Installing browser",
      screen: "progress",
      progress: 46,
      width: 940,
      height: 620,
      description: "The main browser files are installed with a clear progress indicator."
    },
    {
      title: "Installer - Creating shortcuts",
      screen: "progress",
      progress: 81,
      width: 940,
      height: 620,
      description: "Minova creates the selected Windows shortcuts."
    },
    {
      title: "Installer - Final checks",
      screen: "progress",
      progress: 94,
      width: 940,
      height: 620,
      description: "Setup verifies the installation before launch."
    },
    {
      title: "Installer - Complete",
      screen: "complete",
      width: 940,
      height: 620,
      description: "Installation completes with an option to open Minova immediately."
    },
    {
      title: "Update - Ready to restart",
      screen: "update",
      width: 680,
      height: 520,
      description: "A downloaded update presents release notes and restart controls."
    }
  ];

  try {
    for (const screen of screens) {
      const page = await browser.newPage({
        viewport: { width: screen.width, height: screen.height },
        deviceScaleFactor: 1
      });
      const url = new URL(pathToFileURL(previewFile));
      url.searchParams.set("screen", screen.screen);
      await page.goto(url.href, { waitUntil: "load" });
      await page.evaluate(({ releaseVersion, progress }) => {
        document.title = `Minova ${releaseVersion} Installer`;
        document.querySelectorAll("body *").forEach((element) => {
          if (element.children.length === 0 && element.textContent.includes("1.0.2")) {
            element.textContent = element.textContent.replaceAll("1.0.2", releaseVersion);
          }
        });
        if (typeof progress === "number") applyProgress(progress);
      }, { releaseVersion: version, progress: screen.progress });
      await page.evaluate(() => document.fonts.ready);
      const destination = nextPath(screen.title);
      await page.screenshot({ path: destination });
      register(screen.title, "Installer", destination, screen.description);
      process.stdout.write(`Captured ${String(sequence).padStart(2, "0")}: ${screen.title}\n`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function startFixture() {
  return new Promise((resolve, reject) => {
    fixtureServer = http.createServer((request, response) => {
      const planning = request.url.includes("planning");
      const title = planning ? "Launch Planning" : "Release Dashboard";
      const accent = planning ? "#ef6f9a" : "#18c7be";
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8"
      });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              *{box-sizing:border-box}body{margin:0;background:#0d141f;color:#f7fbff;font:16px Segoe UI,Arial}
              header{height:76px;padding:0 38px;display:flex;align-items:center;border-bottom:1px solid #2a3748;background:#101925}
              header i{width:14px;height:14px;border-radius:3px;background:${accent};margin-right:12px}
              main{padding:42px;max-width:1000px}p{color:#9fb2c8;line-height:1.6}
              .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:34px}
              article{border:1px solid #2a3748;background:#121d2a;padding:24px;border-radius:6px;min-height:160px}
              article strong{display:block;color:${accent};font-size:28px;margin-bottom:14px}
              .bar{height:9px;border-radius:3px;background:#263549;margin-top:14px;overflow:hidden}.bar span{display:block;height:100%;background:${accent}}
              h1{font-size:40px;margin:0 0 8px;letter-spacing:0}
            </style>
          </head>
          <body>
            <header><i></i><strong>MINOVA PROJECT</strong></header>
            <main>
              <h1>${title}</h1>
              <p>${planning ? "Coordinate design, testing, documentation, and publishing without losing context." : "A focused view of browser quality, release readiness, and community feedback."}</p>
              <div class="grid">
                <article><strong>${planning ? "12" : "98%"}</strong><span>${planning ? "Tasks ready" : "Tests passing"}</span><div class="bar"><span style="width:${planning ? "72%" : "98%"}"></span></div></article>
                <article><strong>${planning ? "4" : "1.0.3"}</strong><span>${planning ? "Active milestones" : "Current release"}</span><div class="bar"><span style="width:${planning ? "64%" : "86%"}"></span></div></article>
                <article><strong>${planning ? "3" : "24"}</strong><span>${planning ? "Reviewers" : "Resolved reports"}</span><div class="bar"><span style="width:${planning ? "56%" : "91%"}"></span></div></article>
              </div>
            </main>
          </body>
        </html>`);
    });
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", () => resolve(
      `http://127.0.0.1:${fixtureServer.address().port}`
    ));
  });
}

function startApp() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const args = packaged ? [] : [root];
  args.push(`--remote-debugging-port=${port}`);
  appProcess = spawn(executable, args, {
    cwd: root,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MINOVA_USER_DATA_PATH: profile,
      MINOVA_FORCE_ONBOARDING: "1"
    }
  });
  appProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  appProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
}

async function setWindowBounds(shell) {
  try {
    const windowResult = await command(shell, "Browser.getWindowForTarget", {
      targetId: shell.id
    });
    await command(shell, "Browser.setWindowBounds", {
      windowId: windowResult.windowId,
      bounds: {
        left: 80,
        top: 55,
        width: 1920,
        height: 1080,
        windowState: "normal"
      }
    });
    await sleep(450);
  } catch {
    // Castlabs Electron does not expose the Browser window-management domain.
    // The app's deterministic maximized bounds are still suitable for capture.
  }
}

async function captureOnboarding() {
  const isTour = (target) => target.url.endsWith("/src/onboarding.html");
  const tour = await waitForTarget(isTour, "the Minova first-launch tour");
  await waitForExpression(tour, "document.querySelector('#tourContent h1')?.textContent.includes('Set up Minova')", "onboarding welcome");

  await captureTarget(tour, "First launch - Welcome", "First launch", "A visual introduction to Minova and its core browser capabilities.");
  await evaluate(tour, "document.querySelector('#nextButton').click(); true");
  await waitForExpression(tour, "document.querySelectorAll('[data-layout]').length === 2", "interface selection");
  await captureTarget(tour, "First launch - Choose interface", "First launch", "Choose Workspace UI or the traditional Classic UI with a live visual comparison.");
  await evaluate(tour, "document.querySelector('[data-layout=\"workspaces\"]').click(); true");
  await sleep(250);
  await evaluate(tour, "document.querySelector('#nextButton').click(); true");
  await waitForExpression(tour, "document.querySelector('.step-kicker')?.textContent === 'Workspace UI selected'", "workspace workflow step");
  await captureTarget(tour, "First launch - Workspace workflow", "First launch", "An in-depth explanation of spaces, vertical tabs, Split View, and context switching.");
  await evaluate(tour, "document.querySelector('#nextButton').click(); true");
  await waitForExpression(tour, "document.querySelector('.step-kicker')?.textContent === 'More than a tab strip'", "power features step");
  await captureTarget(tour, "First launch - Power features", "First launch", "Protected streaming, extensions, themes, media tools, tab suspension, and encrypted autofill.");
  await evaluate(tour, "document.querySelector('#nextButton').click(); true");
  await waitForExpression(tour, "document.querySelectorAll('[data-password-action]').length === 3", "password import step");
  await captureTarget(tour, "First launch - Import passwords", "First launch", "Google Password Manager export options and Minova's Windows-encrypted local vault.");
  await evaluate(tour, "document.querySelector('[data-password-action=\"later\"]').click(); true");
  await waitForNoTarget(isTour, "the completed first-launch tour");
}

async function captureBrowser(shell, fixtureUrl) {
  await setWindowBounds(shell);
  await waitForExpression(shell, "Boolean(window.minova?.setSettings && typeof state !== 'undefined' && state.tabs.length)", "the ready browser shell");

  await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({
      tabLayout: "workspaces",
      theme: "dark",
      firstRunTourVersion: 1,
      googlePasswordImportState: "declined"
    });
    state.history = [
      { url: "https://www.youtube.com/", title: "YouTube", visitedAt: Date.now() - 60000 },
      { url: "https://github.com/minova-chromium/Minova-Chromium", title: "Minova Chromium", visitedAt: Date.now() - 3600000 },
      { url: "https://www.netflix.com/", title: "Netflix", visitedAt: Date.now() - 7200000 }
    ];
    state.bookmarks = [
      "https://github.com/minova-chromium/Minova-Chromium",
      "https://www.youtube.com/",
      "https://www.netflix.com/"
    ];
    persistHistory();
    persistBookmarks();
    state.sidebarCollapsed = false;
    applyTheme();
    applyInterfaceLayout();
    openTab("minova://newtab");
    return true;
  })()`);
  await sleep(350);
  await captureTarget(shell, "Workspace UI - Expanded sidebar", "Workspace UI", "Color-coded workspaces, vertical tabs, Split View, and private-tab controls remain visible beside the page.");

  await evaluate(shell, "document.querySelector('#toggleSidebarButton').click(); true");
  await waitForExpression(shell, "document.querySelector('.app-shell').classList.contains('sidebar-collapsed')", "the collapsed workspace rail");
  await captureTarget(shell, "Workspace UI - Collapsed sidebar", "Workspace UI", "The sidebar collapses to a narrow workspace and favicon rail for maximum page room.");

  await evaluate(shell, "document.querySelector('#toggleSidebarButton').click(); true");
  await waitForExpression(shell, "!document.querySelector('.app-shell').classList.contains('sidebar-collapsed')", "the expanded workspace sidebar");
  await evaluate(shell, "switchWorkspace('work'); true");
  await sleep(250);
  await captureTarget(shell, "Workspace UI - Work context", "Workspace UI", "Switching workspaces preserves each context and its active tab without destroying it.");

  await evaluate(shell, "openWorkspaceDialog(); true");
  const editor = await waitForTarget((target) => target.url.endsWith("/src/workspace-editor.html"), "the workspace editor");
  await waitForExpression(editor, "Boolean(document.querySelector('#workspaceName'))", "the workspace form");
  await evaluate(editor, `(() => {
    document.querySelector("#workspaceName").value = "Creative";
    document.querySelector("#workspaceColor").value = "#8b7cff";
    return true;
  })()`);
  await captureTarget(editor, "Workspace UI - Create a workspace", "Workspace UI", "Create a named workspace and choose its identifying color.");
  await evaluate(editor, "window.minovaWorkspace.cancel(); true");
  await waitForNoTarget((target) => target.url.endsWith("/src/workspace-editor.html"), "the workspace editor to close");

  const firstTabId = await evaluate(shell, `openTab(${JSON.stringify(`${fixtureUrl}/release`)}).id`);
  await waitForExpression(shell, `state.tabs.find((tab) => tab.id === ${JSON.stringify(firstTabId)})?.loading === false`, "the release dashboard tab");
  const secondTabId = await evaluate(shell, `openTab(${JSON.stringify(`${fixtureUrl}/planning`)}).id`);
  await waitForExpression(shell, `state.tabs.find((tab) => tab.id === ${JSON.stringify(secondTabId)})?.loading === false`, "the planning tab");
  await evaluate(shell, "toggleSplitView(); true");
  await waitForExpression(shell, "(async () => (await window.minova.getBrowserWorkspaceState()).visibleTabIds.length === 2)()", "two visible split panes");
  await sleep(600);
  await captureSplitView(shell, "Workspace UI - Split View", "Workspace UI", "Two live Chromium pages share the available content area while the workspace rail stays accessible.");

  await evaluate(shell, "toggleSplitView(); true");
  await waitForExpression(shell, "(async () => (await window.minova.getBrowserWorkspaceState()).visibleTabIds.length === 1)()", "Split View to close");
  await evaluate(shell, "openTab('minova://newtab'); true");
  await sleep(250);

  await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({ tabLayout: "classic" });
    applyInterfaceLayout();
    return true;
  })()`);
  await waitForExpression(shell, "document.querySelector('.app-shell').classList.contains('classic-ui')", "Classic UI");
  await captureTarget(shell, "Classic UI - Horizontal tabs", "Classic UI", "Traditional horizontal tabs retain Minova's toolbar, themes, extensions, passwords, and media tools.");

  await evaluate(shell, "openTab('minova://newtab', { private: true }); true");
  await sleep(260);
  await captureTarget(shell, "Classic UI - Private tab", "Classic UI", "Private tabs use an isolated browsing partition and a distinct private-browsing new tab.");

  await evaluate(shell, `(async () => {
    state.settings = await window.minova.setSettings({ tabLayout: "workspaces" });
    state.sidebarCollapsed = false;
    applyInterfaceLayout();
    openTab("minova://newtab");
    return true;
  })()`);
  await sleep(250);

  await evaluate(shell, "document.querySelector('#mainMenuButton').click(); true");
  const menu = await waitForTarget((target) => target.url.endsWith("/src/quick-menu.html"), "the Minova quick menu");
  await waitForExpression(menu, "document.querySelectorAll('[data-action]').length > 10", "the populated quick menu");
  await captureTarget(menu, "Menu - Main controls", "Menus", "Chrome-style commands for tabs, history, downloads, bookmarks, extensions, streaming, updates, settings, and more.");

  await evaluate(menu, `document.querySelector('[data-action="history"]').dispatchEvent(new PointerEvent("pointerenter")); true`);
  const submenu = await waitForTarget((target) => target.url.endsWith("/src/quick-submenu.html"), "the history flyout");
  await waitForExpression(submenu, "document.querySelector('#submenuTitle')?.textContent === 'Recent history'", "recent history flyout");
  await captureTarget(submenu, "Menu - Recent history flyout", "Menus", "Recent pages appear in a hover flyout without hiding the active webpage.");

  await evaluate(menu, `document.querySelector('[data-action="bookmarks"]').dispatchEvent(new PointerEvent("pointerenter")); true`);
  await waitForExpression(submenu, "document.querySelector('#submenuTitle')?.textContent === 'Bookmarks'", "bookmarks flyout");
  await captureTarget(submenu, "Menu - Bookmarks flyout", "Menus", "Saved bookmarks are available directly from the quick menu.");
  await evaluate(shell, "window.minova.closeQuickMenu(); true");
  await sleep(200);

  const internalCaptures = [
    ["Passwords and Autofill", "minova://passwords", null, "Passwords", "Google import/resync/export controls and Minova's encrypted local credential vault."],
    ["History - Browsing timeline", "minova://history", null, "Library", "Searchable local browsing history with a one-click clear-all action."],
    ["Bookmarks - Saved pages", "minova://bookmarks", null, "Library", "A dedicated page for opening and removing saved bookmarks."],
    ["Extensions - Manage and pin", "minova://extensions", null, "Extensions", "Install compatible Chrome extensions, load unpacked extensions, and pin actions to the toolbar."],
    ["Settings - Appearance", "minova://settings", "appearance", "Settings", "Choose Workspace or Classic UI, select a theme, and customize every browser color."],
    ["Settings - Privacy and security", "minova://settings", "privacy", "Settings", "Privacy controls and the clear-browsing-data action."],
    ["Settings - Tab performance", "minova://settings", "performance", "Settings", "Smart tab suspension timing, exclusions, and protections for media or unsaved work."],
    ["Settings - Protected content", "minova://settings", "system", "Settings", "Hardware acceleration, spell check, protected-content status, and VMP diagnostics."],
    ["Settings - About and updates", "minova://settings", "about", "Settings", "Version details, GPL license access, automatic updates, and a manual update check."]
  ];

  for (const [title, url, settingsSection, category, description] of internalCaptures) {
    await evaluate(shell, `(() => {
      openTab(${JSON.stringify(url)});
      ${settingsSection ? `renderSettings(${JSON.stringify(settingsSection)});` : ""}
      return true;
    })()`);
    await sleep(280);
    await captureTarget(shell, title, category, description);
  }

  await evaluate(shell, `(() => {
    openTab(${JSON.stringify(`${fixtureUrl}/release`)});
    return true;
  })()`);
  await waitForExpression(shell, "getActiveTab()?.loading === false", "the volume test page");
  await evaluate(shell, "document.querySelector('#volumeButton').click(); true");
  const volume = await waitForTarget((target) => target.url.endsWith("/src/volume-menu.html"), "the volume booster");
  await waitForExpression(volume, "Boolean(document.querySelector('#boostSlider'))", "the volume booster controls");
  await captureTarget(volume, "Media - Volume booster", "Media", "Boost quiet browser audio above 100 percent or reset it instantly.");
  await evaluate(shell, "document.querySelector('#volumeButton').click(); true");

  const existingMedia = [
    {
      source: path.join(root, "scripts", "artifacts", "streaming-prompt-10183.png"),
      title: "Streaming - Compatibility prompt",
      category: "Streaming",
      description: "Supported streaming sites can offer the attached protected Streaming Mode when regular playback fails."
    },
    {
      source: path.join(root, "scripts", "artifacts", "packaged-embedded-composite-10174.png"),
      title: "Streaming - Embedded protected playback",
      category: "Streaming",
      description: "The protected streaming surface follows the Minova window beneath the browser chrome."
    },
    {
      source: path.join(root, "scripts", "artifacts", "html-fullscreen-fixed-composite.png"),
      title: "Streaming - Fullscreen playback",
      category: "Streaming",
      description: "Fullscreen protected playback transitions cleanly and returns to the attached browser layout."
    },
    {
      source: path.join(root, "scripts", "artifacts", "popout-debug-10067.png"),
      title: "Media - Always-on-top popout",
      category: "Media",
      description: "A compact always-on-top media window keeps supported video visible over other applications."
    }
  ];

  for (const item of existingMedia) {
    if (!fs.existsSync(item.source)) continue;
    const destination = nextPath(item.title);
    fs.copyFileSync(item.source, destination);
    register(item.title, item.category, destination, item.description);
    process.stdout.write(`Included ${String(sequence).padStart(2, "0")}: ${item.title}\n`);
  }
}

function writeGallery() {
  const categories = [...new Set(entries.map((entry) => entry.category))];
  const cards = entries.map((entry) => `
    <article class="shot" data-category="${entry.category}">
      <a href="${entry.file}" target="_blank" rel="noreferrer">
        <img src="${entry.file}" alt="${entry.title}" loading="lazy" />
      </a>
      <div>
        <span>${String(entry.number).padStart(2, "0")} / ${entry.category}</span>
        <h2>${entry.title}</h2>
        <p>${entry.description}</p>
      </div>
    </article>`).join("");
  const filters = categories.map((category) => `<button type="button" data-filter="${category}">${category}</button>`).join("");
  const html = `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Minova ${version} visual walkthrough</title>
        <style>
          :root{color-scheme:dark;--bg:#0b111a;--panel:#121b28;--border:#2a394d;--text:#f5f8fc;--muted:#9eb1c8;--accent:#18c7be}
          *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px Segoe UI,Arial,sans-serif}
          header{padding:56px max(24px,calc((100vw - 1420px)/2));border-bottom:1px solid var(--border);background:#0e1622}
          header span,.shot span{color:var(--accent);font-size:12px;font-weight:700;text-transform:uppercase}
          h1{font-size:44px;margin:10px 0 12px;letter-spacing:0}header p,.shot p{color:var(--muted);line-height:1.55}
          nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:26px}button{border:1px solid var(--border);background:var(--panel);color:var(--text);padding:9px 14px;border-radius:5px;cursor:pointer}
          button:hover,button.active{border-color:var(--accent);color:var(--accent)}
          main{max-width:1420px;margin:auto;padding:36px 24px 80px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
          .shot{border:1px solid var(--border);background:var(--panel);border-radius:6px;overflow:hidden}
          .shot a{display:block;background:#070b11;min-height:260px}.shot img{display:block;width:100%;height:390px;object-fit:contain}
          .shot div{padding:18px 20px 22px}.shot h2{font-size:20px;margin:7px 0 5px;letter-spacing:0}.shot p{margin:0}
          .shot.hidden{display:none}@media(max-width:850px){main{grid-template-columns:1fr}.shot img{height:auto}h1{font-size:34px}}
        </style>
      </head>
      <body>
        <header>
          <span>Minova Chromium ${version}</span>
          <h1>Visual walkthrough</h1>
          <p>${entries.length} numbered screens covering installation, first launch, both interface styles, workspaces, menus, settings, media, and protected streaming.</p>
          <nav><button class="active" type="button" data-filter="all">All screens</button>${filters}</nav>
        </header>
        <main>${cards}</main>
        <script>
          document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
            document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
            document.querySelectorAll(".shot").forEach((card) => card.classList.toggle("hidden", button.dataset.filter !== "all" && card.dataset.category !== button.dataset.filter));
          }));
        </script>
      </body>
    </html>`;
  fs.writeFileSync(path.join(outputDirectory, "index.html"), html);
  fs.writeFileSync(path.join(outputDirectory, "README.md"), `# Minova ${version} visual walkthrough

This media pack contains ${entries.length} numbered screenshots captured from the Minova installer, first-launch tour, browser UI, native menus, settings, media controls, and protected streaming workflow.

Open \`index.html\` for the filterable gallery. See \`manifest.json\` for titles, categories, and descriptions.
`);
}

async function cleanUp() {
  if (fixtureServer) {
    await new Promise((resolve) => fixtureServer.close(resolve));
    fixtureServer = null;
  }
  if (appProcess && !appProcess.killed) {
    appProcess.kill();
    await sleep(500);
  }
  fs.rmSync(profile, { recursive: true, force: true });
}

(async () => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  await captureInstallerPreviews();
  const fixtureUrl = await startFixture();
  startApp();
  await captureOnboarding();
  const shell = await waitForTarget((target) => target.url.includes("/src/index.html"), "the Minova browser shell");
  await captureBrowser(shell, fixtureUrl);
  writeGallery();
  fs.writeFileSync(reportPath, JSON.stringify({
    version,
    generatedAt: new Date().toISOString(),
    executable,
    packaged,
    count: entries.length,
    entries
  }, null, 2));
  process.stdout.write(`\nCreated ${entries.length} screenshots in ${outputDirectory}\n`);
})().catch((error) => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    version,
    generatedAt: new Date().toISOString(),
    executable,
    packaged,
    count: entries.length,
    entries,
    error: error.stack || error.message
  }, null, 2));
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(cleanUp);
