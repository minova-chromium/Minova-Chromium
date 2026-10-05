const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10113);
const artifacts = path.join(__dirname, "artifacts");
const reportPath = path.join(artifacts, `media-controls-${port}.json`);
const popupScreenshotPath = path.join(artifacts, `volume-menu-${port}.png`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function save() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
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
        reject(new Error(
          message.error?.message
          || message.result.exceptionDetails.exception?.description
          || message.result.exceptionDetails.text
        ));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, timeoutMs) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  return result.result.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, description, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // Electron's debugging endpoint may still be starting.
    }
    await sleep(200);
  }
  throw new Error(`${description} target was not found`);
}

const MEDIA_FIXTURE = String.raw`
  (async () => {
    document.head.innerHTML = '<title>Minova media controls test</title>';
    document.body.innerHTML = '<main><canvas></canvas><video controls muted></video><audio controls loop></audio></main>';
    document.body.style.cssText = 'margin:0;background:#10161f;color:white;display:grid;place-items:center;min-height:100vh';
    const canvas = document.querySelector('canvas');
    canvas.width = 480;
    canvas.height = 270;
    canvas.style.display = 'none';
    const context = canvas.getContext('2d');
    let frame = 0;
    const paint = () => {
      context.fillStyle = frame % 2 ? '#0f766e' : '#164e63';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.font = '32px Segoe UI';
      context.fillText('Minova media test', 90, 145);
      frame += 1;
      window.__minovaPaintTimer = setTimeout(paint, 100);
    };
    paint();
    const video = document.querySelector('video');
    video.style.cssText = 'width:480px;height:270px;background:#000';
    video.srcObject = canvas.captureStream(10);

    const sampleRate = 8000;
    const sampleCount = sampleRate;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => Array.from(text).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + sampleCount * 2, true);
    write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index += 1) {
      view.setInt16(44 + index * 2, Math.sin(index * Math.PI * 2 * 220 / sampleRate) * 3000, true);
    }
    const audio = document.querySelector('audio');
    audio.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    audio.volume = 0.05;
    await Promise.all([video.play(), audio.play()]);
    return {
      videoReadyState: video.readyState,
      audioReadyState: audio.readyState,
      pictureInPictureEnabled: document.pictureInPictureEnabled
    };
  })()
`;

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"), "Minova shell");
  const tabId = await evaluate(shell, `openTab("https://example.com/").id`);
  report.tabId = tabId;
  await sleep(2500);

  report.fixture = await evaluate(shell, `window.minova.executeBrowserTab(${JSON.stringify(tabId)}, ${JSON.stringify(MEDIA_FIXTURE)})`, 20000);
  await sleep(700);
  report.mediaStatus = await evaluate(shell, `window.minova.getBrowserTabMediaStatus(${JSON.stringify(tabId)})`);
  report.toolbar = await evaluate(shell, `(() => {
    const activeTab = getActiveTab();
    return {
      activeTabId: activeTab?.id,
      tabHasMedia: activeTab?.hasMedia,
      tabHasVideo: activeTab?.hasVideo,
      popoutDisabled: document.querySelector("#popoutButton").disabled,
      volumeDisabled: document.querySelector("#volumeButton").disabled,
      volumeBounds: document.querySelector("#volumeButton").getBoundingClientRect().toJSON(),
      menuRight: document.querySelector("#mainMenuButton").getBoundingClientRect().right,
      innerWidth
    };
  })()`);
  assert(report.mediaStatus.hasMedia && report.mediaStatus.hasVideo, "Minova did not detect the playing HTML5 media fixture");
  assert(!report.toolbar.popoutDisabled && !report.toolbar.volumeDisabled, "Media controls did not become available");
  assert(Math.abs(report.toolbar.menuRight - report.toolbar.innerWidth) < 0.5, "The toolbar edge regressed during media playback");

  await evaluate(shell, `document.querySelector("#volumeButton").click(); true`);
  const volumeMenu = await findTarget((target) => target.url.includes("/src/volume-menu.html"), "Volume menu");
  await sleep(350);
  report.volumeInitial = await evaluate(volumeMenu, `({
    value: document.querySelector("#boostSlider").value,
    disabled: document.querySelector("#boostSlider").disabled,
    status: document.querySelector("#volumeStatus").textContent,
    eqRows: document.querySelectorAll(".eq-row").length,
    presetCount: document.querySelector("#presetSelect").options.length,
    visible: document.visibilityState
  })`);
  assert(report.volumeInitial.eqRows === 10, "Audio Studio did not render all ten EQ bands");
  assert(report.volumeInitial.presetCount >= 5, "Audio Studio built-in presets are missing");
  report.volumeGeometry = await evaluate(shell, `window.minova.getVolumeMenuStatus()`);
  assert(report.volumeGeometry.visible, "Audio Studio panel was not visible");
  assert(
    Math.abs(
      report.volumeGeometry.bounds.x + report.volumeGeometry.bounds.width
      - (report.volumeGeometry.contentBounds.x + report.toolbar.volumeBounds.right)
    ) <= 2,
    "Audio Studio panel is not aligned to the toolbar button"
  );
  assert(
    Math.abs(
      report.volumeGeometry.bounds.y
      - (report.volumeGeometry.contentBounds.y + report.toolbar.volumeBounds.bottom + 6)
    ) <= 2,
    "Audio Studio panel has a vertical toolbar offset"
  );

  await evaluate(shell, `window.minova.toggleMaximizeWindow()`);
  await sleep(500);
  if (!(await evaluate(shell, `window.minova.getVolumeMenuStatus().then((status) => status.visible)`))) {
    await evaluate(shell, `document.querySelector("#volumeButton").click(); true`);
    await sleep(300);
  }
  report.windowedVolumeAnchor = await evaluate(shell, `document.querySelector("#volumeButton").getBoundingClientRect().toJSON()`);
  report.windowedVolumeGeometry = await evaluate(shell, `window.minova.getVolumeMenuStatus()`);
  assert(report.windowedVolumeGeometry.visible, "Audio Studio panel did not reopen in a restored window");
  assert(
    Math.abs(
      report.windowedVolumeGeometry.bounds.x + report.windowedVolumeGeometry.bounds.width
      - (report.windowedVolumeGeometry.contentBounds.x + report.windowedVolumeAnchor.right)
    ) <= 2,
    "Audio Studio panel drifted horizontally in a restored window"
  );
  assert(
    Math.abs(
      report.windowedVolumeGeometry.bounds.y
      - (report.windowedVolumeGeometry.contentBounds.y + report.windowedVolumeAnchor.bottom + 6)
    ) <= 2,
    "Audio Studio panel drifted vertically in a restored window"
  );
  await evaluate(shell, `window.minova.toggleMaximizeWindow()`);
  await sleep(450);
  if (!(await evaluate(shell, `window.minova.getVolumeMenuStatus().then((status) => status.visible)`))) {
    await evaluate(shell, `document.querySelector("#volumeButton").click(); true`);
    await sleep(300);
  }

  await evaluate(volumeMenu, `(() => {
    const select = document.querySelector("#presetSelect");
    select.value = "builtin-bass-boost";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  report.bassPreset = await evaluate(shell, `window.minova.getVolumeMenuStatus()`);
  assert(report.bassPreset.state.audioStudio.activePresetId === "builtin-bass-boost", "Bass Boost preset did not load");
  assert(report.bassPreset.state.headroom.preampDb < -1, "Auto headroom did not protect the boosted EQ curve");

  await evaluate(volumeMenu, `(() => {
    document.querySelector("#presetName").value = "Integration preset";
    document.querySelector("#savePresetButton").click();
    return true;
  })()`);
  await sleep(500);
  report.savedPreset = await evaluate(shell, `window.minova.getVolumeMenuStatus()`);
  const customPreset = report.savedPreset.state.audioStudio.presets.find((preset) => preset.name === "Integration preset");
  assert(customPreset && !customPreset.builtIn, "Custom Audio Studio preset was not saved");
  await evaluate(volumeMenu, `document.querySelector("#deletePresetButton").click(); true`);
  await sleep(500);
  report.deletedPreset = await evaluate(shell, `window.minova.getVolumeMenuStatus()`);
  assert(!report.deletedPreset.state.audioStudio.presets.some((preset) => preset.name === "Integration preset"), "Custom Audio Studio preset was not deleted");

  await evaluate(volumeMenu, `(() => {
    const select = document.querySelector("#presetSelect");
    select.value = "builtin-flat";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(350);
  await evaluate(volumeMenu, `(() => {
    const slider = document.querySelector("#boostSlider");
    slider.value = "175";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  report.volumeBoosted = await evaluate(shell, `Promise.all([
    window.minova.getVolumeMenuStatus(),
    window.minova.getBrowserTabMediaStatus(${JSON.stringify(tabId)})
  ]).then(([menu, media]) => ({ menu, media, buttonActive: document.querySelector("#volumeButton").classList.contains("active") }))`);
  assert(Math.abs(report.volumeBoosted.media.boost - 1.75) < 0.001, "Volume booster did not persist the selected level");
  assert(report.volumeBoosted.menu.state.hasMedia, "Volume popup lost the active tab's media state");

  const popupScreenshot = await command(volumeMenu, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(popupScreenshotPath, Buffer.from(popupScreenshot.data, "base64"));
  report.popupScreenshotPath = popupScreenshotPath;

  report.pictureInPictureRequest = await evaluate(shell, `window.minova.requestBrowserTabPictureInPicture(${JSON.stringify(tabId)})`, 20000);
  await sleep(500);
  report.pictureInPictureActive = await evaluate(shell, `window.minova.executeBrowserTab(${JSON.stringify(tabId)}, "Boolean(document.pictureInPictureElement)")`);
  assert(report.pictureInPictureRequest.active && report.pictureInPictureActive, "Generic Picture-in-Picture did not activate");

  report.capabilities = await evaluate(shell, `window.minova.executeBrowserTab(${JSON.stringify(tabId)}, ${JSON.stringify(`
    (async () => {
      let widevine = false;
      let widevineError = "";
      try {
        await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{
          initDataTypes: ["cenc"],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
          sessionTypes: ["temporary"]
        }]);
        widevine = true;
      } catch (error) {
        widevineError = error.name || error.message;
      }
      return {
        userAgent: navigator.userAgent,
        electronTokenPresent: /Electron\\//i.test(navigator.userAgent),
        h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
        widevine,
        widevineError
      };
    })()
  `)})`, 20000);
  assert(!report.capabilities.electronTokenPresent, "The browsing user agent still exposes Electron");
  assert(report.capabilities.widevine, "Widevine EME is unavailable in the browsing session");

  await evaluate(shell, `window.minova.executeBrowserTab(${JSON.stringify(tabId)}, "document.pictureInPictureElement ? document.exitPictureInPicture().then(() => true) : true")`);
  await evaluate(shell, `window.minova.executeBrowserTab(${JSON.stringify(tabId)}, "Array.from(document.querySelectorAll('audio, video')).forEach((media) => media.pause()); true")`);
  await sleep(2400);
  report.audioIdle = await evaluate(shell, `window.minova.getBrowserTabMediaStatus(${JSON.stringify(tabId)})`);
  assert(report.audioIdle.audioRuntime.contextState === "suspended", "Audio Studio did not suspend its AudioContext after playback stopped");
  await evaluate(volumeMenu, `document.querySelector("#resetButton").click(); true`);
  await sleep(350);
  await evaluate(shell, `window.minova.toggleVolumeMenu({ left: 0, right: 0, top: 0, bottom: 0 }); true`);
  await evaluate(shell, `closeTab(${JSON.stringify(tabId)}); true`);

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
