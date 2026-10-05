const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10010);
const artifactDirectory = path.join(__dirname, "artifacts");
const reportPath = path.join(artifactDirectory, `report-${port}.json`);
let report = { startedAt: new Date().toISOString(), port, stage: "starting", polls: [] };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function saveReport() {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function cdp(webSocketUrl, method, params = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
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
  const result = await cdp(target.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result?.result?.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function getShell() {
  const pages = await targets();
  const shell = pages.find((target) => target.url.includes("/src/index.html"));
  if (!shell) throw new Error("Minova shell target was not found.");
  return shell;
}

async function shellState(shell) {
  return evaluate(shell, `({
    location: location.href,
    activeTabId: state.activeTabId,
    webviewElements: document.querySelectorAll("webview").length,
    pageUnavailableText: document.body.innerText.includes("Page unavailable"),
    tabs: state.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, loading: tab.loading, loadError: tab.loadError }))
  })`);
}

async function main() {
  saveReport();
  const shell = await getShell();
  report.initial = await shellState(shell);
  report.stage = "opening-youtube";
  saveReport();

  report.tabIds = await evaluate(shell, `(() => {
    const googleTab = state.tabs.find((tab) => tab.url.startsWith("https://www.google.com/"));
    const existingYouTube = state.tabs.find((tab) => tab.url === "https://www.youtube.com/");
    const youtubeTab = existingYouTube || openTab("https://www.youtube.com/");
    return { googleTabId: googleTab.id, youtubeTabId: youtubeTab.id };
  })()`);
  await sleep(8000);

  report.stage = "switching-tabs";
  saveReport();
  for (let index = 0; index < 20; index += 1) {
    const tabId = index % 2 === 0 ? report.tabIds.googleTabId : report.tabIds.youtubeTabId;
    await evaluate(shell, `activateTab(${JSON.stringify(tabId)})`);
    await sleep(120);
  }

  report.stage = "reloading-youtube";
  saveReport();
  await evaluate(shell, `activateTab(${JSON.stringify(report.tabIds.youtubeTabId)}); reloadActiveTab(); true`);
  await sleep(8000);

  report.stage = "checking-settings";
  saveReport();
  const settingsTabId = await evaluate(shell, `openTab("minova://extensions").id`);
  await sleep(600);
  report.settingsLayout = await evaluate(shell, `(() => {
    const section = document.querySelector(".settings-section")?.getBoundingClientRect();
    return section ? { width: section.width, height: section.height, display: getComputedStyle(document.querySelector(".settings-section")).display } : null;
  })()`);
  await evaluate(shell, `closeTab(${JSON.stringify(settingsTabId)}); activateTab(${JSON.stringify(report.tabIds.youtubeTabId)}); true`);

  report.stage = "polling-renderers";
  saveReport();
  for (let index = 0; index < 15; index += 1) {
    await sleep(2000);
    const snapshot = await shellState(shell);
    const pages = await targets();
    const youtube = pages.find((target) => target.url === "https://www.youtube.com/");
    let youtubeState = null;
    if (youtube) {
      try {
        youtubeState = await evaluate(youtube, `({ title: document.title, readyState: document.readyState, bodyText: document.body.innerText.slice(0, 120) })`, 8000);
      } catch (error) {
        youtubeState = { error: error.message };
      }
    }
    report.polls.push({ elapsedSeconds: (index + 1) * 2, shell: snapshot, youtube: youtubeState });
    saveReport();
  }

  report.final = await shellState(shell);
  const pages = await targets();
  const youtube = pages.find((target) => target.url === "https://www.youtube.com/");
  if (youtube) {
    const capture = await cdp(youtube.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 20000);
    report.screenshot = path.join(artifactDirectory, `youtube-${port}.png`);
    fs.writeFileSync(report.screenshot, Buffer.from(capture.data, "base64"));
  }
  report.stage = "complete";
  report.finishedAt = new Date().toISOString();
  saveReport();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.stage = "failed";
  report.failedAt = new Date().toISOString();
  report.error = error.stack || error.message;
  saveReport();
  console.error(error);
  process.exitCode = 1;
});
