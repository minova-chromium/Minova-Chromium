import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] || 10441);
const artifacts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "scripts",
  "artifacts"
);
const reportPath = path.join(artifacts, `audio-studio-${port}.json`);
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

function createToneWav(durationSeconds = 8, sampleRate = 44100) {
  const sampleCount = durationSeconds * sampleRate;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 600);
    const sample = Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.08 * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}

async function startFixture() {
  const tone = createToneWav();
  const server = http.createServer((request, response) => {
    if (request.url === "/tone.wav") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": tone.length,
        "content-type": "audio/wav"
      });
      response.end(tone);
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    });
    response.end(`<!doctype html>
      <html>
        <head><title>Audio Studio Fixture</title></head>
        <body>
          <audio id="tone" controls preload="auto" src="/tone.wav"></audio>
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

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target) return target;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function command(target, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(
          message.result?.exceptionDetails?.exception?.description
          || message.result?.exceptionDetails?.text
          || message.error?.message
          || "DevTools command failed."
        ));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression, { userGesture = false } = {}) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture
  });
  return result.result.value;
}

async function waitForExpression(target, expression, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(target, expression)) return;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function main() {
  save();
  const fixture = await startFixture();
  try {
    const shell = await findTarget(
      (target) => target.url.includes("/src/index.html"),
      "the Minova shell"
    );
    const extension = await evaluate(shell, `
      window.minova.listExtensions().then((items) =>
        items.find((item) => item.name === "Minova Audio Studio")
      )
    `);
    assert(extension?.id && extension.hasAction, "Minova Audio Studio did not load with a toolbar action.");
    report.extension = {
      id: extension.id,
      version: extension.version,
      hasAction: extension.hasAction,
      hasIcon: Boolean(extension.icon)
    };

    const tabId = await evaluate(shell, `openTab(${JSON.stringify(fixture.url)}).id`);
    const page = await findTarget(
      (target) => target.url === fixture.url,
      "the audio fixture tab"
    );
    await waitForExpression(page, "document.querySelector('#tone')?.readyState >= 1", "fixture audio");

    await evaluate(shell, `(() => {
      state.pinnedExtensions = [${JSON.stringify(extension.id)}];
      persistPinnedExtensions();
      renderPinnedExtensions();
      document.querySelector("#pinnedExtensions .pinned-extension-button").click();
      return true;
    })()`);
    const popupUrl = `chrome-extension://${extension.id}/src/popup/index.html`;
    const popup = await findTarget(
      (target) => target.url === popupUrl,
      "the Audio Studio popup"
    );
    await waitForExpression(
      popup,
      "document.querySelectorAll('.eq-row').length === 10 && document.querySelector('#presetSelect').options.length >= 3",
      "the complete Audio Studio controls"
    );
    report.popup = await evaluate(popup, `({
      eqBands: document.querySelectorAll(".eq-row").length,
      presets: [...document.querySelector("#presetSelect").options].map((option) => option.textContent),
      compressorEnabled: document.querySelector("#compressorEnabled").checked,
      autoHeadroom: document.querySelector("#autoHeadroomToggle").checked
    })`);
    assert(report.popup.eqBands === 10, "The popup did not render all 10 EQ bands.");
    const popupScreenshot = await command(popup, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    });
    report.popupScreenshot = path.join(artifacts, `audio-studio-popup-${port}.png`);
    fs.writeFileSync(report.popupScreenshot, Buffer.from(popupScreenshot.data, "base64"));

    await evaluate(page, "document.querySelector('#tone').play()", { userGesture: true });
    await waitForExpression(
      popup,
      `(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const status = await chrome.tabs.sendMessage(tab.id, { type: "MINOVA_AUDIO_GET_STATUS" });
        return status.contextState === "running" && status.attachedMediaCount === 1;
      })()`,
      "the live Web Audio graph"
    );
    report.playing = await evaluate(popup, `(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: "MINOVA_AUDIO_GET_STATUS" });
    })()`);
    assert(report.playing.activeMediaCount === 1, "The playing media element was not tracked.");

    await evaluate(popup, `(() => {
      const gain = document.querySelector('.eq-row[data-band-index="0"] input[data-field="gainDb"]');
      gain.value = "6";
      gain.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(
      popup,
      `document.querySelector("#headroomReadout").textContent.includes("-")`,
      "automatic EQ headroom"
    );
    report.headroom = await evaluate(popup, `document.querySelector("#headroomReadout").textContent`);

    await evaluate(popup, `(() => {
      document.querySelector("#presetName").value = "E2E Studio";
      document.querySelector("#savePresetButton").click();
      return true;
    })()`);
    await waitForExpression(
      popup,
      `[...document.querySelector("#presetSelect").options].some((option) => option.textContent === "E2E Studio")`,
      "the saved custom preset"
    );
    const customPresetId = await evaluate(popup, `document.querySelector("#presetSelect").value`);
    assert(customPresetId.startsWith("preset-"), "The custom preset did not receive a valid ID.");

    await evaluate(popup, `(() => {
      const select = document.querySelector("#presetSelect");
      select.value = ${JSON.stringify(customPresetId)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    await evaluate(popup, `document.querySelector("#deletePresetButton").click()`);
    await waitForExpression(
      popup,
      `![...document.querySelector("#presetSelect").options].some((option) => option.value === ${JSON.stringify(customPresetId)})`,
      "custom preset deletion"
    );
    report.presetCrud = true;

    await evaluate(page, "document.querySelector('#tone').pause(); true");
    await sleep(2200);
    report.idle = await evaluate(popup, `(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: "MINOVA_AUDIO_GET_STATUS" });
    })()`);
    assert(report.idle.contextState === "suspended", "AudioContext did not suspend after playback stopped.");

    await evaluate(shell, `closeTab(${JSON.stringify(tabId)}); true`);
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
  console.error(error.stack || error);
  process.exitCode = 1;
});
