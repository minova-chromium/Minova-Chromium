const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [, , edgePath, profilePath, extensionPath, requestedUrl] = process.argv;
const smokeTest = process.argv.includes("--smoke-test");
const runtimeStatePath = profilePath
  ? path.join(profilePath, "minova-runtime.json")
  : null;

function removeRuntimeState() {
  if (!runtimeStatePath || !fs.existsSync(runtimeStatePath)) return;
  try {
    const state = JSON.parse(fs.readFileSync(runtimeStatePath, "utf8"));
    if (state.controllerPid === process.pid) fs.rmSync(runtimeStatePath);
  } catch {
    // A stale or partial state file is safe to leave for the launcher to replace.
  }
}

function validateInputs() {
  for (const [label, target] of [
    ["Microsoft Edge", edgePath],
    ["Minova extension", path.join(extensionPath || "", "manifest.json")],
  ]) {
    if (!target || !fs.existsSync(target)) {
      throw new Error(`${label} was not found at ${target || "(missing path)"}.`);
    }
  }

  const parsed = new URL(requestedUrl || "https://www.google.com/");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Minova Hybrid Browser only opens secure HTTPS addresses.");
  }
  return parsed.href;
}

class PipeProtocol {
  constructor(browser) {
    this.browser = browser;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    browser.stdio[4].on("data", (chunk) => this.onData(chunk));
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.browser.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let separator;
    while ((separator = this.buffer.indexOf(0)) !== -1) {
      const raw = this.buffer.subarray(0, separator).toString("utf8");
      this.buffer = this.buffer.subarray(separator + 1);
      if (!raw) continue;

      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }

      if (!message.id) {
        continue;
      }
      if (!this.pending.has(message.id)) continue;
      const pending = this.pending.get(message.id);
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        pending.resolve(message.result || {});
      }
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function start() {
  const url = validateInputs();
  fs.mkdirSync(profilePath, { recursive: true });

  const browser = spawn(
    edgePath,
    [
      `--user-data-dir=${profilePath}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      "--app=about:blank",
    ],
    {
      windowsHide: false,
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    },
  );

  const protocol = new PipeProtocol(browser);
  let stderr = "";
  browser.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const closeBrowser = () => {
    protocol.send("Browser.close").catch(() => browser.kill());
  };
  process.once("SIGINT", closeBrowser);
  process.once("SIGTERM", closeBrowser);

  browser.once("error", (error) => protocol.rejectAll(error));
  browser.once("exit", (code) => {
    protocol.rejectAll(new Error(`Microsoft Edge exited with code ${code}.`));
    removeRuntimeState();
    process.exitCode = code || 0;
  });

  const extension = await protocol.send("Extensions.loadUnpacked", {
    path: extensionPath,
    enableInIncognito: true,
  });
  const extensionState = await protocol.send("Extensions.getExtensions");

  let page;
  let observedTargets = [];
  for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
    const targets = await protocol.send("Target.getTargets");
    observedTargets = targets.targetInfos;
    page = observedTargets.find(
      (target) =>
        target.type === "page" &&
        !target.url.startsWith("chrome-extension://") &&
        !target.url.startsWith("edge-extension://"),
    );
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) {
    const summary = observedTargets
      .map((target) => `${target.type}:${target.url}`)
      .join(", ");
    throw new Error(`Minova could not find the Edge app page. Targets: ${summary}`);
  }

  const attached = await protocol.send("Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  });
  await protocol.send("Page.enable", {}, attached.sessionId);
  await protocol.send("Page.navigate", { url }, attached.sessionId);

  let pageState = { injected: false, url };
  for (let attempt = 0; attempt < 40 && !pageState.injected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const evaluated = await protocol.send(
        "Runtime.evaluate",
        {
          expression:
            "({ injected: document.documentElement.dataset.minovaHybridUi === 'active' && !!document.getElementById('minova-hybrid-ui'), url: location.href, title: document.title, userAgent: navigator.userAgent, webdriver: navigator.webdriver })",
          returnByValue: true,
        },
        attached.sessionId,
      );
      pageState = evaluated.result?.value || pageState;
    } catch {
      // The execution context is replaced while the initial navigation commits.
    }
  }

  let diagnostics;
  if (smokeTest) {
    const mediaResult = await protocol.send(
      "Runtime.evaluate",
      {
        expression: `
          (async () => {
            const configuration = [{
              initDataTypes: ["cenc"],
              audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
              videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }]
            }];
            const widevine = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", configuration)
              .then(() => true, () => false);
            const shell = document.getElementById("minova-hybrid-ui")?.shadowRoot;
            const tabsBefore = shell?.querySelectorAll(".tab").length || 0;
            shell?.getElementById("newTab")?.click();
            return {
              h264: typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
              widevine,
              shell: Boolean(shell),
              tabsBefore
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true,
      },
      attached.sessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const tabResult = await protocol.send(
      "Runtime.evaluate",
      {
        expression:
          "document.getElementById('minova-hybrid-ui')?.shadowRoot?.querySelectorAll('.tab').length || 0",
        returnByValue: true,
      },
      attached.sessionId,
    );
    diagnostics = {
      ...mediaResult.result?.value,
      tabsAfter: tabResult.result?.value || 0,
    };
    diagnostics.customTabs = diagnostics.tabsAfter > diagnostics.tabsBefore;
    const smokeTargets = await protocol.send("Target.getTargets");
    const pageAutomationStates = [];
    for (const target of smokeTargets.targetInfos.filter((item) => item.type === "page")) {
      try {
        const smokeAttachment = await protocol.send("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
        const automation = await protocol.send(
          "Runtime.evaluate",
          { expression: "navigator.webdriver", returnByValue: true },
          smokeAttachment.sessionId,
        );
        pageAutomationStates.push(Boolean(automation.result?.value));
      } catch {
        pageAutomationStates.push(true);
      }
    }
    diagnostics.pageAutomationStates = pageAutomationStates;
    diagnostics.allPagesHumanControlled = pageAutomationStates.every((value) => !value);
  }

  const readyState = {
    ready: true,
    controllerPid: process.pid,
    browserPid: browser.pid,
    extensionId: extension.id,
    extensionEnabled: Boolean(
      extensionState.extensions?.find((item) => item.id === extension.id)?.enabled,
    ),
    interfaceInjected: pageState.injected,
    profilePath,
    url: pageState.url,
    title: pageState.title,
    userAgent: pageState.userAgent,
    webdriver: pageState.webdriver,
    diagnostics,
    startedAt: new Date().toISOString(),
  };
  const temporaryStatePath = `${runtimeStatePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryStatePath, JSON.stringify(readyState, null, 2));
  fs.renameSync(temporaryStatePath, runtimeStatePath);
  process.stdout.write(`${JSON.stringify(readyState)}\n`);

  await new Promise((resolve) => browser.once("exit", resolve));

  if (stderr && process.exitCode) {
    process.stderr.write(stderr);
  }
}

start().catch((error) => {
  removeRuntimeState();
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

process.once("exit", removeRuntimeState);
