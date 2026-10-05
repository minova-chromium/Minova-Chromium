const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10050);
const reportPath = path.join(__dirname, "artifacts", `media-favicon-${port}.json`);
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

async function command(target, method, params = {}, timeoutMs = 15000) {
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
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
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

async function main() {
  save();
  const shell = (await targets()).find((target) => target.url.includes("/src/index.html"));
  assert(shell, "Minova shell target was not found");

  const youtubeTabId = await evaluate(shell, `openTab("https://www.youtube.com/").id`);
  await sleep(7000);
  report.favicons = await evaluate(shell, `(() => {
    const google = state.tabs.find((tab) => tab.url.startsWith("https://www.google.com"));
    const youtube = state.tabs.find((tab) => tab.id === ${JSON.stringify(youtubeTabId)});
    return {
      google: google?.favicon || "",
      youtube: youtube?.favicon || "",
      renderedImages: document.querySelectorAll(".tab-favicon img").length,
      youtubeRendered: Boolean(document.querySelector('[data-tab-id="' + youtube?.id + '"] .tab-favicon img'))
    };
  })()`);
  assert(report.favicons.google && report.favicons.youtube, "Google or YouTube did not report a favicon");
  assert(report.favicons.renderedImages >= 2 && report.favicons.youtubeRendered, "Site favicons were not rendered in the tab strip");

  await evaluate(shell, `window.minova.openVideoPopout({
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    currentTime: 0,
    title: "Minova popout test"
  })`);
  await sleep(1000);
  report.popoutInitialStatus = await evaluate(shell, `window.minova.getVideoPopoutStatus()`);
  await sleep(9000);
  report.popoutFinalStatus = await evaluate(shell, `window.minova.getVideoPopoutStatus()`);
  const pages = await targets();
  const player = pages.find((target) => target.url.includes("youtube.com/watch?v=M7lc1UVf-VE"));
  assert(player, "YouTube popout player target was not found");
  report.popout = await evaluate(player, `({
    title: document.title,
    readyState: document.readyState,
    text: document.body.innerText.slice(0, 500),
    error153: document.body.innerText.includes("Error 153"),
    configError: document.body.innerText.includes("Video player configuration error"),
    unavailable: document.body.innerText.includes("This video is unavailable"),
    videoElements: document.querySelectorAll("video").length,
    videoReadyState: document.querySelector("video")?.readyState || 0,
    videoRect: (() => {
      const rect = document.querySelector("video")?.getBoundingClientRect();
      return rect ? { width: rect.width, height: rect.height } : null;
    })(),
    playerPosition: getComputedStyle(document.querySelector("#movie_player") || document.body).position
  })`);
  assert(!report.popout.error153 && !report.popout.configError, "YouTube popout still reports error 153");
  assert(!report.popout.unavailable, "YouTube's embeddable API sample was unavailable in the popout");
  assert(report.popout.readyState === "complete", "YouTube popout did not finish loading");
  assert(report.popout.videoElements === 1 && report.popout.videoReadyState >= 2, "YouTube popout video did not become playable");
  assert(report.popout.videoRect?.width >= 300 && report.popout.videoRect?.height >= 180, "YouTube popout video surface collapsed or remained invisible");
  assert(report.popout.playerPosition === "fixed", "YouTube popout did not enter player-only layout");

  await evaluate(shell, `closeTab(${JSON.stringify(youtubeTabId)}); true`);
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
