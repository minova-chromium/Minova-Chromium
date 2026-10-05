const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const STREAMING_PROFILE_NAME = "Minova Streaming";

function browserCandidates(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    const inDirectory = (base, ...parts) => base ? path.join(base, ...parts) : "";
    return [
      { name: "Microsoft Edge", path: inDirectory(env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") },
      { name: "Microsoft Edge", path: inDirectory(env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") },
      { name: "Microsoft Edge", path: inDirectory(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") },
      { name: "Google Chrome", path: inDirectory(env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") },
      { name: "Google Chrome", path: inDirectory(env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") },
      { name: "Google Chrome", path: inDirectory(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") }
    ];
  }

  if (platform === "darwin") {
    return [
      { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }
    ];
  }

  return [
    { name: "Microsoft Edge", path: "/usr/bin/microsoft-edge-stable" },
    { name: "Microsoft Edge", path: "/usr/bin/microsoft-edge" },
    { name: "Google Chrome", path: "/usr/bin/google-chrome-stable" },
    { name: "Google Chrome", path: "/usr/bin/google-chrome" }
  ];
}

function findCertifiedStreamingBrowser(options = {}) {
  const candidates = options.candidates || browserCandidates(options.env, options.platform);
  return candidates.find((candidate) => candidate.path && fs.existsSync(candidate.path)) || null;
}

function normalizeStreamingUrl(value) {
  const input = String(value || "").trim();
  if (!input || /^(?:minova|about|chrome|edge):/i.test(input)) return null;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Streaming Mode needs a valid HTTPS web address.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Streaming Mode only opens secure HTTPS pages.");
  }
  if (url.username || url.password) {
    throw new Error("Streaming Mode will not open an address containing embedded credentials.");
  }
  return url.href;
}

function createStreamingLaunch(options = {}) {
  const browser = options.browser || findCertifiedStreamingBrowser(options);
  if (!browser) {
    throw new Error("Minova could not find Microsoft Edge or Google Chrome on this computer.");
  }

  const rawAppDataPath = String(options.appDataPath || "").trim();
  if (!rawAppDataPath) {
    throw new Error("Minova could not create a dedicated streaming profile.");
  }
  const appDataPath = path.resolve(rawAppDataPath);
  if (appDataPath === path.parse(appDataPath).root) throw new Error("Minova could not create a dedicated streaming profile.");

  const profilePath = path.join(appDataPath, STREAMING_PROFILE_NAME);
  const url = normalizeStreamingUrl(options.url);
  const args = [
    `--user-data-dir=${profilePath}`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized"
  ];
  if (url) {
    // App mode keeps the certified browser's DRM pipeline while removing its
    // normal tab strip and address bar, so Streaming Mode feels like Minova.
    args.push(`--app=${url}`);
  } else {
    args.push("--new-window");
  }

  return { browser, profilePath, url, args };
}

async function launchStreamingMode(options = {}) {
  const launch = createStreamingLaunch(options);
  fs.mkdirSync(launch.profilePath, { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn(launch.browser.path, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

  return {
    browser: launch.browser.name,
    profilePath: launch.profilePath,
    url: launch.url,
    presentation: launch.url ? "app" : "window"
  };
}

module.exports = {
  STREAMING_PROFILE_NAME,
  browserCandidates,
  findCertifiedStreamingBrowser,
  normalizeStreamingUrl,
  createStreamingLaunch,
  launchStreamingMode
};
