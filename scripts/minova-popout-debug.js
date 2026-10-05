const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10067);
const artifactDirectory = path.join(__dirname, "artifacts");
const reportPath = path.join(artifactDirectory, `popout-debug-${port}.json`);
const screenshotPath = path.join(artifactDirectory, `popout-debug-${port}.png`);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const shell = (await targets()).find((target) => target.url.includes("/src/index.html"));
  if (!shell) throw new Error("Minova shell target not found");
  await evaluate(shell, `window.minova.openVideoPopout({
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    currentTime: 0,
    title: "Minova visual debug"
  })`);

  const report = { startedAt: new Date().toISOString(), polls: [] };
  let player = null;
  for (let index = 0; index < 24; index += 1) {
    await sleep(500);
    const status = await evaluate(shell, `window.minova.getVideoPopoutStatus()`);
    const pages = await targets();
    player = pages.find((target) => target.url.includes("youtube.com/watch?v=M7lc1UVf-VE")) || null;
    report.polls.push({ elapsedMs: (index + 1) * 500, status, playerFound: Boolean(player) });
    if (player && index >= 5) break;
  }
  if (!player) throw new Error("YouTube player target disappeared before inspection");

  if (process.argv.includes("--inject-fix")) {
    await evaluate(player, `(() => {
      const style = document.createElement("style");
      style.textContent = [
        ".html5-video-container {",
        "position: fixed !important; inset: 0 !important;",
        "width: 100vw !important; height: 100vh !important;",
        "min-height: 100vh !important; overflow: hidden !important;",
        "}",
        "video, video.video-stream.html5-main-video {",
        "position: fixed !important; inset: 0 !important;",
        "width: 100vw !important; height: 100vh !important;",
        "min-width: 100vw !important; min-height: 100vh !important;",
        "max-width: none !important; max-height: none !important;",
        "object-fit: contain !important; opacity: 1 !important; visibility: visible !important;",
        "}"
      ].join("\\n");
      document.documentElement.appendChild(style);
      document.querySelector("video")?.play().catch(() => {});
      return true;
    })()`);
    report.injectedFix = true;
    await sleep(1500);
  }

  report.video = await evaluate(player, `(() => {
    const video = document.querySelector("video");
    const player = document.querySelector("#movie_player");
    const style = video ? getComputedStyle(video) : null;
    const rect = video?.getBoundingClientRect();
    const quality = video?.getVideoPlaybackQuality?.();
    return {
      readyState: video?.readyState,
      networkState: video?.networkState,
      paused: video?.paused,
      currentTime: video?.currentTime,
      duration: video?.duration,
      videoWidth: video?.videoWidth,
      videoHeight: video?.videoHeight,
      decodedFrames: video?.webkitDecodedFrameCount,
      droppedFrames: video?.webkitDroppedFrameCount,
      totalVideoFrames: quality?.totalVideoFrames,
      corruptedVideoFrames: quality?.corruptedVideoFrames,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      display: style?.display,
      visibility: style?.visibility,
      opacity: style?.opacity,
      filter: style?.filter,
      transform: style?.transform,
      objectFit: style?.objectFit,
      zIndex: style?.zIndex,
      playerClasses: player?.className,
      playerState: player?.getPlayerState?.(),
      playerError: player?.getPlayerError?.(),
      documentVisibility: document.visibilityState
    };
  })()`);

  const screenshot = await command(player, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  report.screenshot = screenshotPath;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
