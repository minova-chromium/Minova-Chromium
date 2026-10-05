const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [, , edgePath, profilePath, extensionPath] = process.argv;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (!edgePath || !profilePath || !extensionPath) {
  fail("Usage: node install-extension-pipe.js <edge.exe> <profile> <extension>");
  return;
}

for (const [label, target] of [
  ["Microsoft Edge", edgePath],
  ["Minova extension", path.join(extensionPath, "manifest.json")],
]) {
  if (!fs.existsSync(target)) {
    fail(`${label} was not found at ${target}`);
    return;
  }
}

fs.mkdirSync(profilePath, { recursive: true });

const browser = spawn(
  edgePath,
  [
    `--user-data-dir=${profilePath}`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-minimized",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "about:blank",
  ],
  {
    windowsHide: false,
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  },
);

let buffer = Buffer.alloc(0);
let completed = false;
let stderr = "";

const timeout = setTimeout(() => {
  finish(new Error("Edge did not complete extension installation within 30 seconds."));
}, 30_000);

browser.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

browser.stdio[4].on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let separator;
  while ((separator = buffer.indexOf(0)) !== -1) {
    const raw = buffer.subarray(0, separator).toString("utf8");
    buffer = buffer.subarray(separator + 1);
    if (!raw) continue;

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      continue;
    }

    if (message.id !== 1) continue;
    if (message.error) {
      finish(new Error(`Edge rejected the Minova extension: ${message.error.message}`));
      return;
    }

    const result = {
      installed: true,
      extensionId: message.result.id,
      profilePath,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    browser.stdio[3].write(
      `${JSON.stringify({ id: 2, method: "Browser.close" })}\0`,
    );
    finish();
  }
});

browser.once("error", finish);
browser.once("exit", (code) => {
  if (!completed && code !== 0) {
    finish(new Error(`Edge setup exited with code ${code}. ${stderr.trim()}`));
  }
});

browser.stdio[3].write(
  `${JSON.stringify({
    id: 1,
    method: "Extensions.loadUnpacked",
    params: { path: extensionPath, enableInIncognito: true },
  })}\0`,
);

function finish(error) {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);

  if (error) {
    if (!browser.killed) browser.kill();
    fail(error.message);
    return;
  }

  setTimeout(() => {
    if (!browser.killed) browser.kill();
  }, 2_000).unref();
}
