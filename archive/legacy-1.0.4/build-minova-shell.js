#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { execFileSync, spawnSync } = require("node:child_process");

const DEFAULT_SOURCE = String.raw`C:\Users\DEVELOPER\Documents\Minova Browser`;
const DEFAULT_PARENT = __dirname;
const MSI_FILENAME = "GoogleChromeStandaloneEnterprise64.msi";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const VM_TEST_EXTENSION = {
  id: "cogjejgaeokemlpmjoigdkdlglbdmeni",
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5M+4eiQ+CBsUOgIEHlk9sh4Ueoc/nlevlzT2/Dwz+XQt9jlntXAEyHjOttXvZfNhhePIZTGt0rgQXGvWYvUUuXeKzlrF5ODPr+m+5/ff+iCtUMQe6LYax3PfEImRjC0XtRhaedaijN/5CyywvMjkbylXcLyW5WhBvHdJnZl13rhnx5RK5ag28RcF/tp1/g87yU3dvOpbBCm2IuSmGtC3gmT5aL1+tEaQZuuLKGe2jGfVg5Lse6ZdJMTpySzWmZgsQEOzUE4jFS++EUbo77R6wnmcBQ9Fu8nY/SG+NiQXJjUgzii7OnfC07EznXK997QwxLaRBGPBohiFbegopJYW7QIDAQAB"
};

function fail(message) {
  console.error(`\nMinova shell build failed: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    target: "",
    msi: "",
    extensionId: "",
    storeUrl: "",
    prepareOnly: false,
    vmTest: false,
    force: false,
    allowUnverifiedMsi: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value.`);
      index += 1;
      return value;
    };

    if (argument === "--source") options.source = next();
    else if (argument === "--target") options.target = next();
    else if (argument === "--msi") options.msi = next();
    else if (argument === "--extension-id") options.extensionId = next();
    else if (argument === "--store-url") options.storeUrl = next();
    else if (argument === "--prepare-only") options.prepareOnly = true;
    else if (argument === "--vm-test") options.vmTest = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--allow-unverified-msi") options.allowUnverifiedMsi = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else fail(`Unknown argument: ${argument}`);
  }

  if (!options.target) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    options.target = path.join(DEFAULT_PARENT, `Minova-Shell-Package-${stamp}`);
  }
  if (options.vmTest) {
    if (options.extensionId && options.extensionId !== VM_TEST_EXTENSION.id) {
      fail("--vm-test uses its own deterministic extension ID; do not combine it with --extension-id.");
    }
    options.extensionId = VM_TEST_EXTENSION.id;
    options.storeUrl = "chrome://extensions/";
  }
  if (options.extensionId && !EXTENSION_ID_PATTERN.test(options.extensionId)) {
    fail("--extension-id must be the 32-character Chrome Web Store extension ID (letters a-p only). ");
  }
  if (!options.storeUrl && options.extensionId) {
    options.storeUrl = `https://chromewebstore.google.com/detail/${options.extensionId}`;
  }
  return options;
}

function printHelp() {
  console.log(String.raw`
Minova Chrome-backed shell generator

Prepare and build an installer:
  node build-minova-shell.js --msi "C:\Installers\GoogleChromeStandaloneEnterprise64.msi" --extension-id abcdefghijklmnopabcdefghijklmnop

Generate and inspect the staged project without installing dependencies:
  node build-minova-shell.js --prepare-only --target "C:\Builds\Minova Shell Stage"

Options:
  --source <dir>          Read-only Minova source (default: ${DEFAULT_SOURCE})
  --target <dir>          New staging directory (default: timestamped folder here)
  --msi <file>            Official offline Chrome Enterprise x64 MSI
  --extension-id <id>     Published Chrome Web Store extension ID
  --store-url <url>       Override the extension's Chrome Web Store URL
  --prepare-only          Generate sources but do not run package installation/build
  --vm-test               Build a VM installer without bundling Chrome; load its unpacked extension manually
  --force                 Delete an existing, explicitly selected safe target
  --allow-unverified-msi  Permit a non-valid Authenticode result (not recommended)
  --help                  Show this help
`);
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isAncestor(ancestor, candidate) {
  const relative = path.relative(path.resolve(ancestor), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeTarget(source, target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const home = path.resolve(os.homedir());
  if (samePath(resolved, root) || samePath(resolved, home) || resolved.length < root.length + 8) {
    fail(`Refusing unsafe target directory: ${resolved}`);
  }
  if (isAncestor(resolved, source) || isAncestor(source, resolved) || samePath(resolved, __dirname)) {
    fail("The target must be separate from the source and from the generator directory.");
  }
}

function prepareTarget(source, target, force) {
  assertSafeTarget(source, target);
  if (fs.existsSync(target)) {
    if (!force) fail(`Target already exists. Choose a new target or pass --force: ${target}`);
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  fs.mkdirSync(target, { recursive: true });
}

const COPY_ENTRIES = [
  "src",
  "assets",
  "scripts",
  "LICENSE",
  "README.md",
  "pnpm-workspace.yaml"
];

function shouldCopy(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/").toLowerCase();
  return !(
    normalized.includes("/node_modules/") ||
    normalized.includes("/.pnpm-store/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/app/") ||
    normalized.includes("/.git/") ||
    normalized.includes("/scripts/artifacts/") ||
    normalized.endsWith(".log")
  );
}

function cloneSource(source, target) {
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Source directory does not exist: ${source}`);
  }
  for (const entry of COPY_ENTRIES) {
    const from = path.join(source, entry);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(target, entry), {
      recursive: true,
      errorOnExist: false,
      filter: shouldCopy
    });
  }
}

function writeFile(target, relativePath, content) {
  const destination = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content.replace(/^\n/, ""), "utf8");
}

function writeJson(target, relativePath, value) {
  writeFile(target, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function powershellJson(command) {
  const output = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true }
  );
  return JSON.parse(output.trim());
}

function verifyAndCopyMsi(msiPath, target, allowUnverified) {
  if (!msiPath) return null;
  const resolved = path.resolve(msiPath);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) fail(`MSI not found: ${resolved}`);
  if (path.extname(resolved).toLowerCase() !== ".msi") fail("The Chrome installer must be an .msi file.");

  const escaped = resolved.replaceAll("'", "''");
  const signature = powershellJson(
    `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; ` +
    `[pscustomobject]@{Status=[string]$s.Status;Subject=[string]$s.SignerCertificate.Subject}|ConvertTo-Json -Compress`
  );
  const trustedGoogleSignature = signature.Status === "Valid" && /Google/i.test(signature.Subject || "");
  if (!trustedGoogleSignature && !allowUnverified) {
    fail(`Chrome MSI signature was not accepted (status=${signature.Status}, signer=${signature.Subject || "unknown"}).`);
  }

  const destination = path.join(target, "build", MSI_FILENAME);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(resolved, destination, fs.constants.COPYFILE_EXCL);
  return {
    file: MSI_FILENAME,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex"),
    signature
  };
}

function packageJson() {
  return {
    name: "minova-chrome-shell",
    version: "1.0.1",
    description: "Minova UI companion shell for an isolated official Google Chrome profile.",
    main: "shell/main.js",
    author: "Minova",
    license: "GPL-3.0-only",
    private: true,
    scripts: {
      start: "electron .",
      pack: "electron-builder --dir",
      dist: "electron-builder --win nsis --x64",
      "import:chrome": "node scripts/import-chrome-data.js"
    },
    dependencies: {
      ws: "^8.18.3"
    },
    devDependencies: {
      electron: "43.0.0",
      "electron-builder": "26.15.3"
    },
    build: {
      appId: "com.minova.chrome.shell",
      productName: "Minova Browser",
      executableName: "MinovaBrowser",
      asar: true,
      files: [
        "shell/**/*",
        "assets/**/*",
        "extension/**/*",
        "LICENSE",
        "package.json"
      ],
      extraResources: [
        { from: "extension", to: "extension-controller" }
      ],
      directories: {
        buildResources: "build",
        output: "dist"
      },
      win: {
        icon: "assets/logos/minova-browser.png",
        target: [{ target: "nsis", arch: ["x64"] }]
      },
      nsis: {
        oneClick: false,
        perMachine: true,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        include: "build/installer.nsh",
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Minova Browser",
        runAfterFinish: false,
        artifactName: "Minova-Browser-Setup-${version}-${arch}.${ext}"
      }
    }
  };
}

function mainJs() {
  return String.raw`
"use strict";

const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { WebSocketServer, WebSocket } = require("ws");
const BUILD_CONFIG = require("./build-config.json");

const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("appData"), "..").replace(/[\\/]$/, "");
const minovaRoot = path.resolve(localAppData, "MinovaBrowser");
const profilePath = path.join(minovaRoot, "ProfileData");
const settingsPath = path.join(minovaRoot, "settings.json");
const controllerPath = app.isPackaged
  ? path.join(process.resourcesPath, "extension-controller", "manifest.json")
  : path.join(__dirname, "..", "extension", "manifest.json");

function readSettings() {
  try {
    return { hardwareAcceleration: true, ...JSON.parse(fs.readFileSync(settingsPath, "utf8")) };
  } catch {
    return { hardwareAcceleration: true };
  }
}

function saveSettings(partial) {
  fs.mkdirSync(minovaRoot, { recursive: true });
  const next = { ...readSettings(), ...partial };
  const temporary = settingsPath + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(temporary, settingsPath);
  return next;
}

if (!readSettings().hardwareAcceleration) app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-features", "ChromeSigninIntercept");

let splashWindow = null;
let shellWindow = null;
let chromeProcess = null;
let chromeExecutablePath = "";
let bridge = null;
let quitting = false;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(label, promise, milliseconds) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(label + " timed out after " + milliseconds + " ms.");
        error.code = "STEP_TIMEOUT";
        reject(error);
      }, milliseconds);
    })
  ]);
}

function updateSplash(status, detail = "") {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send("bootstrap:status", { status, detail });
}

function createSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  splashWindow = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    center: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "splash-preload.js")
    }
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => {
    splashWindow.show();
    updateSplash("Initializing Minova Core Engine...");
  });
}

function createProfile() {
  fs.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
  const probe = path.join(profilePath, ".minova-write-test");
  fs.writeFileSync(probe, "ok", "utf8");
  fs.unlinkSync(probe);
}

function chromeCandidates() {
  return [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
}

function verifyChromeAndController() {
  if (!/^[a-p]{32}$/.test(BUILD_CONFIG.extensionId || "")) {
    const error = new Error("This build does not contain a published Chrome Web Store extension ID.");
    error.code = "EXTENSION_NOT_CONFIGURED";
    throw error;
  }
  if (!fs.existsSync(controllerPath)) {
    const error = new Error("The packaged Minova extension controller manifest is missing.");
    error.code = "EXTENSION_FILES_MISSING";
    throw error;
  }
  const chrome = chromeCandidates().find((candidate) => fs.existsSync(candidate));
  if (!chrome) {
    const error = new Error("System Google Chrome was not found. Repair the Minova installation to deploy the bundled Enterprise MSI.");
    error.code = "CHROME_NOT_FOUND";
    throw error;
  }
  chromeExecutablePath = chrome;
  return chrome;
}

class ExtensionBridge {
  constructor() {
    this.server = null;
    this.httpServer = null;
    this.socket = null;
    this.port = 0;
    this.token = crypto.randomBytes(32).toString("hex");
    this.pending = new Map();
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
  }

  async listen() {
    this.httpServer = http.createServer((request, response) => this.handleHttp(request, response));
    this.server = new WebSocketServer({ server: this.httpServer, maxPayload: 1024 * 1024 });
    this.server.on("connection", (socket, request) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.searchParams.get("token") !== this.token) {
        socket.close(1008, "Invalid session token");
        return;
      }
      if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, "Replaced");
      this.socket = socket;
      socket.on("message", (data) => this.onMessage(data));
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        shellWindow?.webContents.send("bridge:state", { connected: false });
      });
    });
    this.server.on("error", (error) => console.error("Minova WebSocket bridge error:", error));
    await new Promise((resolve, reject) => {
      this.httpServer.once("listening", resolve);
      this.httpServer.once("error", reject);
      this.httpServer.listen(0, "127.0.0.1");
    });
    this.port = this.httpServer.address().port;
  }

  handleHttp(request, response) {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/bridge-bootstrap.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(fs.readFileSync(path.join(__dirname, "bridge-bootstrap.js")));
      return;
    }
    if (requestUrl.pathname !== "/bootstrap") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(fs.readFileSync(path.join(__dirname, "bridge-bootstrap.html")));
  }

  onMessage(data) {
    let message;
    try { message = JSON.parse(data.toString("utf8")); } catch { return; }
    if (message.type === "hello" && message.extensionId === BUILD_CONFIG.extensionId) {
      this.resolveReady(message);
      shellWindow?.webContents.send("bridge:state", { connected: true });
      return;
    }
    if (message.type === "response" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Extension command failed."));
      return;
    }
    if (message.type === "event") shellWindow?.webContents.send("bridge:event", message);
  }

  command(command, payload = {}, timeout = 10000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The Minova Chrome extension is not connected."));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Chrome command timed out: " + command));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ type: "command", id, command, payload }));
    });
  }

  async close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Minova is shutting down."));
    }
    this.pending.clear();
    this.socket?.close(1000, "Shutdown");
    await new Promise((resolve) => this.server ? this.server.close(resolve) : resolve());
    await new Promise((resolve) => this.httpServer ? this.httpServer.close(resolve) : resolve());
  }
}

function chromeBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const toolbarHeight = 104;
  return {
    shell: { x: workArea.x, y: workArea.y, width: workArea.width, height: toolbarHeight },
    chrome: {
      x: workArea.x,
      y: workArea.y + toolbarHeight,
      width: workArea.width,
      height: Math.max(480, workArea.height - toolbarHeight)
    }
  };
}

function launchChrome(chromeExecutable, targetUrl, appMode = true) {
  const bounds = chromeBounds().chrome;
  const settings = readSettings();
  const args = [
    "--user-data-dir=" + profilePath,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-position=" + bounds.x + "," + bounds.y,
    "--window-size=" + bounds.width + "," + bounds.height
  ];
  if (!settings.hardwareAcceleration) args.push("--disable-gpu");
  args.push(appMode ? "--app=" + targetUrl : "--new-window", ...(appMode ? [] : [targetUrl]));
  chromeProcess = spawn(chromeExecutable, args, { detached: false, stdio: "ignore", windowsHide: false });
  chromeProcess.once("error", (error) => console.error("Could not launch Chrome:", error));
  return chromeProcess;
}

function bootstrapUrl(startUrl = "https://www.google.com/") {
  const url = new URL("http://127.0.0.1:" + bridge.port + "/bootstrap");
  const fragment = new URLSearchParams({
    extensionId: BUILD_CONFIG.extensionId,
    port: String(bridge.port),
    token: bridge.token,
    start: startUrl
  });
  return url.href + "#" + fragment.toString();
}

function createShell() {
  const bounds = chromeBounds().shell;
  shellWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    maximizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  shellWindow.setMenuBarVisibility(false);
  shellWindow.loadFile(path.join(__dirname, "shell.html"));
  shellWindow.once("ready-to-show", () => shellWindow.show());
  shellWindow.on("closed", () => {
    shellWindow = null;
    if (!quitting) app.quit();
  });
}

async function openExtensionInstall(chromeExecutable) {
  launchChrome(chromeExecutable, BUILD_CONFIG.storeUrl, false);
  await dialog.showMessageBox(splashWindow, {
    type: "info",
    title: "Install the Minova controller",
    message: "Install the Minova Browser Controller from the Chrome Web Store.",
    detail: "Chrome requires one-time user consent for consumer extensions. After installation, close the store window and choose Retry.",
    buttons: ["Continue"],
    noLink: true
  });
}

async function recover(stage, error, context) {
  updateSplash(stage.status, error.message);
  const buttons = stage.id === "synchronize"
    ? ["Retry", "Open Chrome Web Store", "Quit"]
    : ["Retry", "Quit"];
  const result = await dialog.showMessageBox(splashWindow, {
    type: "error",
    title: "Minova setup needs attention",
    message: stage.status,
    detail: error.message,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  });
  if (stage.id === "synchronize" && result.response === 1) {
    await openExtensionInstall(context.chromeExecutable);
    return "retry";
  }
  return result.response === 0 ? "retry" : "quit";
}

class BootstrapCoordinator {
  constructor() {
    this.context = {};
    this.stages = [
      {
        id: "initialize",
        status: "Initializing Minova Core Engine...",
        timeout: 10000,
        run: async () => { createSplash(); await delay(650); }
      },
      {
        id: "sandbox",
        status: "Allocating isolated local sandbox...",
        timeout: 10000,
        run: async () => { createProfile(); await delay(450); }
      },
      {
        id: "verify",
        status: "Configuring hardware streaming protocols...",
        timeout: 10000,
        run: async () => {
          this.context.chromeExecutable = verifyChromeAndController();
          await delay(450);
        }
      },
      {
        id: "synchronize",
        status: "Optimizing interface layers...",
        timeout: 30000,
        run: async () => {
          if (!bridge) {
            bridge = new ExtensionBridge();
            await bridge.listen();
          }
          launchChrome(this.context.chromeExecutable, bootstrapUrl(), true);
          await bridge.readyPromise;
        }
      },
      {
        id: "launch",
        status: "Launching Minova Browser...",
        timeout: 10000,
        run: async () => { createShell(); await delay(700); }
      }
    ];
  }

  async run() {
    for (const stage of this.stages) {
      let completed = false;
      while (!completed) {
        updateSplash(stage.status);
        try {
          await withTimeout(stage.id, stage.run(), stage.timeout);
          completed = true;
        } catch (error) {
          console.error("Bootstrap stage " + stage.id + " failed:", error);
          const action = await recover(stage, error, this.context);
          if (action !== "retry") throw error;
        }
      }
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send("bootstrap:complete");
      await delay(450);
      splashWindow.destroy();
      splashWindow = null;
    }
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.on("second-instance", () => shellWindow?.focus());

app.whenReady().then(async () => {
  try {
    await new BootstrapCoordinator().run();
  } catch (error) {
    console.error("Minova bootstrap failed:", error);
    app.quit();
  }
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { bridge?.close().catch(() => {}); });
app.on("window-all-closed", () => app.quit());

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set-hardware", async (_event, enabled) => {
  const settings = saveSettings({ hardwareAcceleration: Boolean(enabled) });
  const result = await dialog.showMessageBox(shellWindow, {
    type: "question",
    title: "Restart Minova?",
    message: "Hardware acceleration changes require a complete local relaunch.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) {
    try { await bridge?.command("system.shutdown", {}, 5000); } catch {}
    app.relaunch();
    app.exit(0);
  }
  return settings;
});
ipcMain.handle("bridge:command", (_event, command, payload) => bridge.command(String(command), payload || {}));
ipcMain.handle("bridge:state", () => ({ connected: Boolean(bridge?.socket?.readyState === WebSocket.OPEN) }));
ipcMain.handle("window:minimize", () => shellWindow?.minimize());
ipcMain.handle("window:close", () => shellWindow?.close());
ipcMain.handle("extension:open-store", () => {
  if (BUILD_CONFIG.storeUrl.startsWith("chrome://") && chromeExecutablePath) {
    launchChrome(chromeExecutablePath, BUILD_CONFIG.storeUrl, false);
    return true;
  }
  return shell.openExternal(BUILD_CONFIG.storeUrl);
});
`;
}

function preloadJs() {
  return String.raw`
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaShell", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setHardwareAcceleration: (enabled) => ipcRenderer.invoke("settings:set-hardware", Boolean(enabled)),
  command: (command, payload) => ipcRenderer.invoke("bridge:command", command, payload),
  getBridgeState: () => ipcRenderer.invoke("bridge:state"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  openExtensionStore: () => ipcRenderer.invoke("extension:open-store"),
  onBridgeEvent: (callback) => ipcRenderer.on("bridge:event", (_event, message) => callback(message)),
  onBridgeState: (callback) => ipcRenderer.on("bridge:state", (_event, state) => callback(state))
});
`;
}

function splashPreloadJs() {
  return String.raw`
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("minovaSplash", {
  onStatus: (callback) => ipcRenderer.on("bootstrap:status", (_event, value) => callback(value)),
  onComplete: (callback) => ipcRenderer.on("bootstrap:complete", callback)
});
`;
}

function splashHtml() {
  return String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Starting Minova</title>
  <link rel="stylesheet" href="splash.css" />
</head>
<body>
  <main class="card" id="card">
    <img src="../assets/logos/minova-browser.png" alt="Minova" />
    <h1>Minova Browser</h1>
    <div class="spinner" aria-hidden="true"></div>
    <p id="status" aria-live="polite">Initializing Minova Core Engine...</p>
    <small id="detail"></small>
  </main>
  <script src="splash.js"></script>
</body>
</html>
`;
}

function splashCss() {
  return String.raw`
:root { color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: transparent; }
body { display: grid; place-items: center; }
.card {
  width: 500px; min-height: 320px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 34px; color: #f8fbff; text-align: center;
  border: 1px solid rgba(255,255,255,.13); border-radius: 26px;
  background: radial-gradient(circle at 50% 0%, rgba(60,129,255,.30), transparent 45%), #111725;
  box-shadow: 0 28px 90px rgba(0,0,0,.55); transition: opacity .4s ease, transform .4s ease;
}
.card.done { opacity: 0; transform: scale(.975); }
img { width: 76px; height: 76px; object-fit: contain; filter: drop-shadow(0 10px 28px rgba(55,123,255,.35)); }
h1 { margin: 14px 0 22px; font-size: 27px; letter-spacing: -.5px; }
.spinner { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,.15); border-top-color: #63a2ff; border-radius: 50%; animation: spin .8s linear infinite; }
p { min-height: 24px; margin: 22px 0 5px; color: #eaf2ff; font-size: 15px; transition: opacity .18s ease; }
small { min-height: 18px; color: #ffb8b8; max-width: 410px; }
@keyframes spin { to { transform: rotate(360deg); } }
`;
}

function splashJs() {
  return String.raw`
"use strict";
const status = document.getElementById("status");
const detail = document.getElementById("detail");
window.minovaSplash.onStatus((next) => {
  status.style.opacity = "0";
  setTimeout(() => {
    status.textContent = next.status || "Starting Minova...";
    detail.textContent = next.detail || "";
    status.style.opacity = "1";
  }, 170);
});
window.minovaSplash.onComplete(() => document.getElementById("card").classList.add("done"));
`;
}

function shellHtml() {
  return String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Minova Browser</title>
  <link rel="stylesheet" href="shell.css" />
</head>
<body>
  <header>
    <div class="tabs-row">
      <div class="brand"><img src="../assets/logos/minova-browser.png" alt="" /><span>Minova</span></div>
      <div id="tabs" class="tabs" aria-label="Browser tabs"></div>
      <button id="newTab" title="New tab">+</button>
      <span class="drag-region"></span>
      <label class="gpu" title="Requires restart"><input id="gpuToggle" type="checkbox" /> GPU</label>
      <span id="bridgeState" class="bridge-state">Connected</span>
      <button id="minimize" title="Minimize">—</button>
      <button id="close" class="close" title="Close">×</button>
    </div>
    <nav>
      <button id="back" title="Back">←</button>
      <button id="forward" title="Forward">→</button>
      <button id="reload" title="Reload">↻</button>
      <form id="addressForm"><input id="address" autocomplete="off" spellcheck="false" aria-label="Address" /></form>
      <button id="store" title="Minova controller extension">Extension</button>
    </nav>
  </header>
  <script src="shell.js"></script>
</body>
</html>
`;
}

function shellCss() {
  return String.raw`
:root { color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111827; color: #edf4ff; }
header { height: 104px; border-bottom: 1px solid #263248; background: linear-gradient(#172238, #111827); box-shadow: 0 8px 30px rgba(0,0,0,.28); }
.tabs-row, nav { display: flex; align-items: center; gap: 7px; padding: 7px 10px; }
.tabs-row { height: 50px; }
nav { height: 54px; padding-top: 4px; }
.brand { display: flex; align-items: center; gap: 7px; padding: 0 7px 0 2px; font-weight: 650; }
.brand img { width: 27px; height: 27px; object-fit: contain; }
.tabs { display: flex; align-items: center; gap: 5px; overflow: hidden; max-width: 65vw; }
.tab { display: flex; align-items: center; gap: 8px; min-width: 130px; max-width: 220px; height: 34px; padding: 0 10px; border-radius: 9px; background: #202c42; border: 1px solid transparent; cursor: pointer; }
.tab.active { background: #2b3b58; border-color: #4d648d; }
.tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tab-close { padding: 0; background: transparent; font-size: 16px; }
.drag-region { flex: 1; height: 100%; -webkit-app-region: drag; }
button, .gpu { -webkit-app-region: no-drag; }
button { height: 34px; min-width: 34px; border: 0; border-radius: 8px; color: #eaf2ff; background: #243149; cursor: pointer; font: inherit; }
button:hover { background: #334565; }
button.close:hover { background: #c42b3c; }
.gpu { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #c9d6eb; }
.bridge-state { font-size: 11px; color: #8ee5ac; }
.bridge-state.offline { color: #ffacac; }
#addressForm { flex: 1; }
#address { width: 100%; height: 38px; border: 1px solid #33445f; border-radius: 11px; outline: none; padding: 0 14px; background: #0c1320; color: #f5f8ff; font: inherit; }
#address:focus { border-color: #5892e8; box-shadow: 0 0 0 3px rgba(69,130,221,.18); }
#store { padding: 0 13px; }
`;
}

function shellJs() {
  return String.raw`
"use strict";
const tabsElement = document.getElementById("tabs");
const address = document.getElementById("address");
const bridgeState = document.getElementById("bridgeState");
let tabs = [];
let activeTabId = null;

function normalizeAddress(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "https://www.google.com/";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s.]+(\s+[^\s.]+)+$/.test(trimmed) || trimmed.includes(" ")) {
    return "https://www.google.com/search?q=" + encodeURIComponent(trimmed);
  }
  return "https://" + trimmed;
}

function renderTabs() {
  tabsElement.replaceChildren();
  for (const tab of tabs) {
    const button = document.createElement("div");
    button.className = "tab" + (tab.id === activeTabId ? " active" : "");
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "New tab";
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      window.minovaShell.command("tabs.remove", { tabId: tab.id }).catch(showError);
    });
    button.append(title, close);
    button.addEventListener("click", () => window.minovaShell.command("tabs.activate", { tabId: tab.id }).catch(showError));
    tabsElement.append(button);
  }
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active && document.activeElement !== address) address.value = active.url || "";
}

function showError(error) {
  console.error(error);
  bridgeState.textContent = error.message || "Command failed";
  bridgeState.classList.add("offline");
}

async function refreshTabs() {
  const snapshot = await window.minovaShell.command("tabs.query");
  tabs = snapshot.tabs || [];
  activeTabId = snapshot.activeTabId ?? activeTabId;
  renderTabs();
}

window.minovaShell.onBridgeEvent((message) => {
  if (message.event === "tabs.snapshot") {
    tabs = message.payload.tabs || [];
    activeTabId = message.payload.activeTabId ?? activeTabId;
    renderTabs();
  } else refreshTabs().catch(showError);
});
window.minovaShell.onBridgeState((state) => {
  bridgeState.textContent = state.connected ? "Connected" : "Disconnected";
  bridgeState.classList.toggle("offline", !state.connected);
});

document.getElementById("addressForm").addEventListener("submit", (event) => {
  event.preventDefault();
  window.minovaShell.command("tabs.navigate", { tabId: activeTabId, url: normalizeAddress(address.value) }).catch(showError);
});
document.getElementById("back").addEventListener("click", () => window.minovaShell.command("tabs.back", { tabId: activeTabId }).catch(showError));
document.getElementById("forward").addEventListener("click", () => window.minovaShell.command("tabs.forward", { tabId: activeTabId }).catch(showError));
document.getElementById("reload").addEventListener("click", () => window.minovaShell.command("tabs.reload", { tabId: activeTabId }).catch(showError));
document.getElementById("newTab").addEventListener("click", () => window.minovaShell.command("tabs.create", { url: "https://www.google.com/" }).catch(showError));
document.getElementById("store").addEventListener("click", () => window.minovaShell.openExtensionStore());
document.getElementById("minimize").addEventListener("click", () => window.minovaShell.minimize());
document.getElementById("close").addEventListener("click", () => window.minovaShell.close());
document.getElementById("gpuToggle").addEventListener("change", (event) => window.minovaShell.setHardwareAcceleration(event.target.checked));

(async () => {
  const settings = await window.minovaShell.getSettings();
  document.getElementById("gpuToggle").checked = settings.hardwareAcceleration !== false;
  await refreshTabs();
})().catch(showError);
`;
}

function migrationJs() {
  return String.raw`
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function requireSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    throw new Error("Chrome History import requires Node.js 22.16 or newer (node:sqlite backup API). ");
  }
}

function defaultConsumerProfile(profileName = "Default") {
  if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not defined.");
  return path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data", profileName);
}

function defaultMinovaProfile(profileName = "Default") {
  if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not defined.");
  return path.join(process.env.LOCALAPPDATA, "MinovaBrowser", "ProfileData", profileName);
}

function isChromeRunning() {
  if (process.platform !== "win32") return false;
  try {
    const output = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true
    });
    return /"chrome\.exe"/i.test(output);
  } catch {
    return true;
  }
}

function assertChromeStopped() {
  if (isChromeRunning()) {
    throw new Error("Close every Google Chrome and Minova Chrome window before importing Bookmarks or History.");
  }
}

function atomicReplace(temporary, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const backup = destination + ".before-minova-" + Date.now() + ".bak";
  if (fs.existsSync(destination)) fs.renameSync(destination, backup);
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(destination)) fs.renameSync(backup, destination);
    throw error;
  }
  return fs.existsSync(backup) ? backup : null;
}

function cloneBookmarks(sourceProfile, destinationProfile) {
  const source = path.join(sourceProfile, "Bookmarks");
  if (!fs.existsSync(source)) return { imported: false, reason: "No Bookmarks file" };
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  if (!parsed.roots || typeof parsed.roots !== "object") throw new Error("Chrome Bookmarks JSON has no roots object.");
  const destination = path.join(destinationProfile, "Bookmarks");
  const temporary = destination + ".minova-" + process.pid + ".tmp";
  fs.mkdirSync(destinationProfile, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(parsed, null, 2), { encoding: "utf8", mode: 0o600 });
  return { imported: true, backup: atomicReplace(temporary, destination) };
}

async function cloneHistory(sourceProfile, destinationProfile) {
  const { backup, DatabaseSync } = requireSqlite();
  if (typeof backup !== "function") throw new Error("This Node.js runtime does not provide sqlite.backup(). Use Node 22.16 or newer.");
  const source = path.join(sourceProfile, "History");
  if (!fs.existsSync(source)) return { imported: false, reason: "No History database" };
  fs.mkdirSync(destinationProfile, { recursive: true });
  const destination = path.join(destinationProfile, "History");
  const temporary = destination + ".minova-" + process.pid + ".tmp";
  const sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  try {
    const check = sourceDb.prepare("PRAGMA quick_check").all();
    if (!check.some((row) => Object.values(row).includes("ok"))) throw new Error("Chrome History failed SQLite quick_check.");
    await backup(sourceDb, temporary, { rate: 128 });
  } finally {
    sourceDb.close();
  }
  const cloneDb = new DatabaseSync(temporary, { readOnly: true, timeout: 5000 });
  try {
    const check = cloneDb.prepare("PRAGMA quick_check").all();
    if (!check.some((row) => Object.values(row).includes("ok"))) throw new Error("Cloned History failed SQLite quick_check.");
  } finally {
    cloneDb.close();
  }
  return { imported: true, backup: atomicReplace(temporary, destination) };
}

async function importChromeData(options = {}) {
  assertChromeStopped();
  const profileName = options.profileName || "Default";
  const sourceProfile = path.resolve(options.sourceProfile || defaultConsumerProfile(profileName));
  const destinationProfile = path.resolve(options.destinationProfile || defaultMinovaProfile(profileName));
  if (!fs.statSync(sourceProfile, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("Chrome profile was not found: " + sourceProfile);
  }
  if (sourceProfile.toLowerCase() === destinationProfile.toLowerCase()) {
    throw new Error("Source and destination profiles must be different.");
  }
  return {
    sourceProfile,
    destinationProfile,
    bookmarks: cloneBookmarks(sourceProfile, destinationProfile),
    history: await cloneHistory(sourceProfile, destinationProfile)
  };
}

module.exports = { assertChromeStopped, cloneBookmarks, cloneHistory, defaultConsumerProfile, defaultMinovaProfile, importChromeData, isChromeRunning };
`;
}

function importCliJs() {
  return String.raw`
#!/usr/bin/env node
"use strict";
const path = require("node:path");
const { importChromeData } = require("../shell/migration");

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

importChromeData({
  profileName: valueAfter("--profile") || "Default",
  sourceProfile: valueAfter("--source") ? path.resolve(valueAfter("--source")) : undefined,
  destinationProfile: valueAfter("--destination") ? path.resolve(valueAfter("--destination")) : undefined
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
`;
}

function extensionManifest(vmTest) {
  const manifest = {
    manifest_version: 3,
    name: "Minova Browser Controller",
    version: "1.0.1",
    description: "Connects the Minova companion UI to tabs in Minova's isolated Chrome profile.",
    minimum_chrome_version: "137",
    permissions: ["tabs", "storage"],
    host_permissions: ["http://127.0.0.1/*"],
    externally_connectable: { matches: ["http://127.0.0.1/*"] },
    background: { service_worker: "service-worker.js" },
    action: { default_title: "Minova Browser Controller" },
    options_page: "options.html",
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' ws://127.0.0.1:*"
    }
  };
  if (vmTest) manifest.key = VM_TEST_EXTENSION.key;
  return manifest;
}

function extensionWorkerJs() {
  return String.raw`
"use strict";
let socket = null;
let reconnectTimer = null;
let bridgeConfig = null;

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function snapshot() {
  const tabs = await chrome.tabs.query({});
  const active = tabs.find((tab) => tab.active && tab.windowId === chrome.windows.WINDOW_ID_CURRENT)
    || tabs.find((tab) => tab.active);
  return {
    activeTabId: active?.id ?? null,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title || "New tab",
      url: tab.url || tab.pendingUrl || "",
      status: tab.status || ""
    }))
  };
}

async function emitSnapshot() {
  send({ type: "event", event: "tabs.snapshot", payload: await snapshot() });
}

async function handle(command, payload) {
  const tabId = Number(payload?.tabId);
  if (command === "tabs.query") return snapshot();
  if (command === "tabs.create") return chrome.tabs.create({ url: payload.url || "https://www.google.com/", active: true });
  if (command === "tabs.navigate") return chrome.tabs.update(tabId, { url: payload.url, active: true });
  if (command === "tabs.activate") return chrome.tabs.update(tabId, { active: true });
  if (command === "tabs.remove") return chrome.tabs.remove(tabId);
  if (command === "tabs.back") return chrome.tabs.goBack(tabId);
  if (command === "tabs.forward") return chrome.tabs.goForward(tabId);
  if (command === "tabs.reload") return chrome.tabs.reload(tabId);
  if (command === "system.shutdown") {
    const windows = await chrome.windows.getAll();
    await Promise.all(windows.filter((win) => Number.isInteger(win.id)).map((win) => chrome.windows.remove(win.id).catch(() => {})));
    return true;
  }
  throw new Error("Unsupported Minova command: " + command);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect().catch(scheduleReconnect), 1500);
}

async function connect() {
  if (!bridgeConfig?.port || !bridgeConfig?.token) return;
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  socket = new WebSocket("ws://127.0.0.1:" + bridgeConfig.port + "/?token=" + encodeURIComponent(bridgeConfig.token));
  socket.addEventListener("open", async () => {
    send({ type: "hello", extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version });
    await emitSnapshot();
  });
  socket.addEventListener("message", async (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type !== "command") return;
    try {
      const result = await handle(message.command, message.payload || {});
      send({ type: "response", id: message.id, ok: true, result });
      await emitSnapshot();
    } catch (error) {
      send({ type: "response", id: message.id, ok: false, error: error.message || String(error) });
    }
  });
  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket?.close());
}

function configureBridge(message, respond) {
  if (message?.type !== "minova:configure") return false;
  const port = Number(message.port);
  const token = String(message.token || "");
  if (!Number.isInteger(port) || port < 1 || !/^[a-f0-9]{64}$/.test(token)) {
    respond({ ok: false, error: "Invalid Minova bridge configuration." });
    return false;
  }
  bridgeConfig = { port, token };
  chrome.storage.local.set({ bridgeConfig }).then(connect).then(() => respond({ ok: true })).catch((error) => respond({ ok: false, error: error.message }));
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  return configureBridge(message, respond);
});

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!sender.url?.startsWith("http://127.0.0.1:")) return false;
  return configureBridge(message, respond);
});

for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onActivated, chrome.tabs.onUpdated, chrome.tabs.onMoved]) {
  event.addListener(() => emitSnapshot().catch(() => {}));
}
chrome.windows.onFocusChanged.addListener(() => emitSnapshot().catch(() => {}));
chrome.runtime.onStartup.addListener(() => chrome.storage.local.get("bridgeConfig").then((data) => { bridgeConfig = data.bridgeConfig; return connect(); }));
chrome.storage.local.get("bridgeConfig").then((data) => { bridgeConfig = data.bridgeConfig; return connect(); }).catch(() => {});
`;
}

function bridgeBootstrapHtml() {
  return String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connecting Minova</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px system-ui, sans-serif; background: #111827; color: #eef5ff; }
    main { box-sizing: border-box; width: min(560px, calc(100% - 40px)); padding: 40px; border: 1px solid #34445f; border-radius: 18px; background: #18243a; }
    h1 { margin-top: 0; }
    p { color: #c8d5e9; line-height: 1.55; }
  </style>
</head>
<body>
  <main><h1>Connecting Minova...</h1><p id="status">Contacting the installed Minova controller.</p></main>
  <script src="/bridge-bootstrap.js"></script>
</body>
</html>
`;
}

function bridgeBootstrapJs() {
  return String.raw`
"use strict";
(() => {
  const values = new URLSearchParams(location.hash.slice(1));
  const extensionId = values.get("extensionId") || "";
  const port = Number(values.get("port"));
  const token = values.get("token") || "";
  const start = values.get("start") || "https://www.google.com/";
  const status = document.getElementById("status");
  const fail = (message) => {
    status.textContent = message;
    status.style.color = "#ffb4b4";
  };

  if (!/^[a-p]{32}$/.test(extensionId) || !Number.isInteger(port) || port < 1 || !/^[a-f0-9]{64}$/.test(token)) {
    fail("Invalid Minova session parameters.");
    return;
  }
  if (!globalThis.chrome?.runtime?.sendMessage) {
    fail("The Minova controller is not installed in this Chrome profile.");
    return;
  }

  const timer = setTimeout(() => {
    fail("The Minova controller did not answer. Reload it in chrome://extensions and restart Minova.");
  }, 10000);

  chrome.runtime.sendMessage(extensionId, { type: "minova:configure", port, token }, (reply) => {
    clearTimeout(timer);
    if (chrome.runtime.lastError) {
      fail(chrome.runtime.lastError.message || "The Minova controller could not be reached.");
      return;
    }
    if (!reply?.ok) {
      fail(reply?.error || "The Minova controller rejected the session.");
      return;
    }
    history.replaceState(null, "", "/bootstrap");
    location.replace(start);
  });
})();
`;
}

function extensionBootstrapHtml() {
  return String.raw`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Connecting Minova</title><link rel="stylesheet" href="extension.css" /></head>
<body><main><h1>Connecting Minova…</h1><p id="status">Securing the local companion connection.</p></main><script src="bootstrap.js"></script></body>
</html>
`;
}

function extensionBootstrapJs() {
  return String.raw`
"use strict";
(async () => {
  const values = new URLSearchParams(location.hash.slice(1));
  const port = Number(values.get("port"));
  const token = values.get("token") || "";
  const start = values.get("start") || "https://www.google.com/";
  if (!Number.isInteger(port) || port < 1 || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid Minova bridge configuration.");
  const response = await chrome.runtime.sendMessage({ type: "minova:configure", port, token });
  if (!response?.ok) throw new Error(response?.error || "The Minova service worker did not accept the session.");
  history.replaceState(null, "", location.pathname);
  await chrome.tabs.update({ url: start });
})().catch((error) => {
  document.getElementById("status").textContent = error.message || String(error);
});
`;
}

function extensionOptionsHtml() {
  return String.raw`
<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Minova Controller</title><link rel="stylesheet" href="extension.css" /></head><body><main><h1>Minova Browser Controller</h1><p>This extension only accepts authenticated loopback sessions created by the installed Minova desktop companion.</p><p>No browsing data is sent to Minova servers.</p></main></body></html>
`;
}

function extensionCss() {
  return String.raw`
:root { color-scheme: dark; font-family: system-ui, sans-serif; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #eef5ff; } main { max-width: 560px; padding: 40px; border: 1px solid #34445f; border-radius: 18px; background: #18243a; } h1 { margin-top: 0; } p { color: #c8d5e9; line-height: 1.55; }
`;
}

function installerNsh(vmTest) {
  const nsis = "$";
  const slash = "\\";
  if (vmTest) return String.raw`
!include "LogicLib.nsh"

; VM test build: Chrome is intentionally not redistributed. Install official
; Google Chrome in the VM before running this installer.
!macro customInstall
  DetailPrint "Checking for Google Chrome required by the VM test build..."
  ${nsis}{If} ${nsis}{FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    Goto minova_vm_chrome_ready
  ${nsis}{EndIf}
  ${nsis}{If} ${nsis}{FileExists} "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
    Goto minova_vm_chrome_ready
  ${nsis}{EndIf}
  ${nsis}{If} ${nsis}{FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    Goto minova_vm_chrome_ready
  ${nsis}{EndIf}
  MessageBox MB_ICONSTOP|MB_OK "Install official Google Chrome in this virtual machine before installing the Minova VM test build."
  Abort
  minova_vm_chrome_ready:
!macroend
`;
  return String.raw`
!include "LogicLib.nsh"

; electron-builder sets RequestExecutionLevel through perMachine=true. Defining it
; again here would produce a duplicate NSIS directive.
!macro customInstall
  DetailPrint "Checking for system Google Chrome..."
  ${nsis}{If} ${nsis}{FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    DetailPrint "System Google Chrome is already installed."
    Goto minova_chrome_ready
  ${nsis}{EndIf}
  ${nsis}{If} ${nsis}{FileExists} "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
    DetailPrint "System Google Chrome is already installed."
    Goto minova_chrome_ready
  ${nsis}{EndIf}

  SetOutPath "$PLUGINSDIR"
  File "/oname=${MSI_FILENAME}" "${nsis}{BUILD_RESOURCES_DIR}${slash}${MSI_FILENAME}"
  DetailPrint "Installing Google Chrome Enterprise..."
  ExecWait '"$SYSDIR${slash}msiexec.exe" /i "$PLUGINSDIR${slash}${MSI_FILENAME}" /qn /norestart' $0
  ${nsis}{If} $0 == 0
    DetailPrint "Google Chrome Enterprise installed successfully."
  ${nsis}{ElseIf} $0 == 3010
    DetailPrint "Google Chrome installed; Windows restart is recommended."
    SetRebootFlag true
  ${nsis}{ElseIf} $0 == 1641
    DetailPrint "Google Chrome installed and requested a restart."
    SetRebootFlag true
  ${nsis}{Else}
    MessageBox MB_ICONSTOP|MB_OK "Google Chrome Enterprise installation failed with Windows Installer exit code $0. Minova Browser was not installed completely."
    Abort
  ${nsis}{EndIf}

  minova_chrome_ready:
  ; Desktop and Start Menu shortcuts are created by electron-builder and target
  ; only $INSTDIR\MinovaBrowser.exe. This script does not alter existing Chrome shortcuts.
!macroend
`;
}

function generatedReadme(options, msiInfo) {
  return `# Minova Chrome-backed Shell – generated stage

This folder was generated from the read-only source at:

\`${options.source}\`

The shell uses official installed Google Chrome for browsing and an isolated profile at
\`%LOCALAPPDATA%\\MinovaBrowser\\ProfileData\`. The Chrome Web Store extension requires
one-time user consent and connects only to an authenticated loopback WebSocket opened by
the Minova Electron process.

## Build

\`pnpm install --frozen-lockfile=false\`  
\`pnpm dist\`

The installer is emitted under \`dist\`. The NSIS build is per-machine/elevated and runs
the bundled Enterprise MSI only when a system Chrome executable is not already present.

## Chrome data import

Close every Chrome and Minova Chrome window, then run:

\`pnpm import:chrome -- --profile Default\`

History is opened read-only and cloned with SQLite's online backup API, which incorporates
the database/WAL view without mutating the source. Existing Minova Bookmarks and History
files are retained as timestamped backups.

## Consumer extension

Submit the \`extension\` directory to the Chrome Web Store. The configured extension ID is
\`${options.extensionId || "NOT CONFIGURED – prepare-only stage"}\`. A production build must use the ID
assigned to the published listing.

## MSI provenance

${msiInfo ? `Bundled file: \`${msiInfo.file}\`  
SHA-256: \`${msiInfo.sha256}\`  
Authenticode: \`${msiInfo.signature.Status}\` — \`${msiInfo.signature.Subject}\`` : "No MSI was staged. Add one by rerunning the generator with `--msi`."}

## Important limitations

- Google Chrome does not permit silent consumer extension installation. Installation is a
  user-consent step through the Chrome Web Store.
- The Minova toolbar and Chrome content are synchronized companion windows, not an embedded
  or reparented Chrome rendering surface.
- An unsigned Electron installer may still trigger Windows SmartScreen even though protected
  playback occurs in Google's signed Chrome binary.
${options.vmTest ? `
## VM test extension setup

This is a VM-only build with deterministic unpacked extension ID
\`${VM_TEST_EXTENSION.id}\`. After installing Minova, its extension directory is:

\`C:\\Program Files\\Minova Browser\\resources\\extension-controller\`

On first Minova launch, choose **Open Chrome Web Store** in the recovery dialog. In the
\`chrome://extensions\` page, enable **Developer mode**, choose **Load unpacked**, select
the directory above, return to Minova, and choose **Retry**. Do not distribute this test
extension as the production Chrome Web Store package.
` : ""}
`;
}

function generateProject(target, options, msiInfo) {
  writeJson(target, "package.json", packageJson());
  writeJson(target, "shell/build-config.json", {
    extensionId: options.extensionId || "__MINOVA_EXTENSION_ID__",
    storeUrl: options.storeUrl || "https://chromewebstore.google.com/"
  });
  writeFile(target, "shell/main.js", mainJs());
  writeFile(target, "shell/bridge-bootstrap.html", bridgeBootstrapHtml());
  writeFile(target, "shell/bridge-bootstrap.js", bridgeBootstrapJs());
  writeFile(target, "shell/preload.js", preloadJs());
  writeFile(target, "shell/splash-preload.js", splashPreloadJs());
  writeFile(target, "shell/splash.html", splashHtml());
  writeFile(target, "shell/splash.css", splashCss());
  writeFile(target, "shell/splash.js", splashJs());
  writeFile(target, "shell/shell.html", shellHtml());
  writeFile(target, "shell/shell.css", shellCss());
  writeFile(target, "shell/shell.js", shellJs());
  writeFile(target, "shell/migration.js", migrationJs());
  writeFile(target, "scripts/import-chrome-data.js", importCliJs());
  writeJson(target, "extension/manifest.json", extensionManifest(options.vmTest));
  writeFile(target, "extension/service-worker.js", extensionWorkerJs());
  writeFile(target, "extension/bootstrap.html", extensionBootstrapHtml());
  writeFile(target, "extension/bootstrap.js", extensionBootstrapJs());
  writeFile(target, "extension/options.html", extensionOptionsHtml());
  writeFile(target, "extension/extension.css", extensionCss());
  writeFile(target, "build/installer.nsh", installerNsh(options.vmTest));
  writeFile(target, "BUILDING-MINOVA-SHELL.md", generatedReadme(options, msiInfo));
  writeFile(target, ".gitignore", "node_modules/\ndist/\n*.log\n");
}

function resolvePackageManager() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = process.platform === "win32"
    ? [
        ["pnpm.cmd", []],
        [path.join(executableDirectory, "pnpm.cmd"), []],
        ["corepack.cmd", ["pnpm"]],
        [path.join(executableDirectory, "corepack.cmd"), ["pnpm"]],
        ["npm.cmd", []],
        [path.join(executableDirectory, "npm.cmd"), []]
      ]
    : [["pnpm", []], ["corepack", ["pnpm"]], ["npm", []]];
  for (const [command, prefix] of candidates) {
    const check = spawnSync(command, [...prefix, "--version"], {
      stdio: "ignore",
      windowsHide: true,
      shell: process.platform === "win32"
    });
    if (check.status === 0) return { command, prefix };
  }
  fail("Could not find pnpm, Corepack, or npm on PATH.");
}

function runBuild(target) {
  const manager = resolvePackageManager();
  const isNpm = /npm(?:\.cmd)?$/i.test(manager.command);
  const installArgs = isNpm ? ["install"] : ["install", "--frozen-lockfile=false"];
  const commands = [installArgs, ["run", "dist"]];
  for (const args of commands) {
    const fullArgs = [...manager.prefix, ...args];
    console.log(`\n> ${manager.command} ${fullArgs.join(" ")}\n`);
    const result = spawnSync(manager.command, fullArgs, {
      cwd: target,
      stdio: "inherit",
      windowsHide: false,
      shell: process.platform === "win32"
    });
    if (result.error) fail(result.error.message);
    if (result.status !== 0) fail(`Build command exited with code ${result.status}: ${manager.command} ${fullArgs.join(" ")}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  options.source = path.resolve(options.source);
  options.target = path.resolve(options.target);

  if (!options.prepareOnly && !options.vmTest && !options.msi) fail("A production build requires --msi <official Chrome Enterprise MSI>.");
  if (!options.prepareOnly && !options.vmTest && !options.extensionId) fail("A production build requires --extension-id <published Chrome Web Store ID>.");

  console.log(`Source (read-only): ${options.source}`);
  console.log(`Fresh target:      ${options.target}`);
  prepareTarget(options.source, options.target, options.force);
  cloneSource(options.source, options.target);
  const msiInfo = verifyAndCopyMsi(options.msi, options.target, options.allowUnverifiedMsi);
  generateProject(options.target, options, msiInfo);

  if (!options.prepareOnly) runBuild(options.target);

  console.log("\nMinova shell stage completed successfully.");
  console.log(`Project: ${options.target}`);
  if (!options.prepareOnly) console.log(`Installer output: ${path.join(options.target, "dist")}`);
  else console.log("Preparation-only mode: dependencies and installer were not built.");
}

try {
  main();
} catch (error) {
  if (!process.exitCode) {
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}
