const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  findCertifiedStreamingBrowser,
  normalizeStreamingUrl,
  createStreamingLaunch
} = require("../src/streaming-mode");

const browser = findCertifiedStreamingBrowser();
assert(browser, "A certified Microsoft Edge or Google Chrome installation is required.");
assert(fs.existsSync(path.join(__dirname, "..", "src", "streaming-overlay.ps1")), "The Windows streaming overlay helper must be bundled.");
assert.equal(normalizeStreamingUrl("https://www.netflix.com"), "https://www.netflix.com/");
assert.equal(normalizeStreamingUrl("minova://newtab"), null);
assert.throws(() => normalizeStreamingUrl("http://example.com"), /HTTPS/);
assert.throws(() => normalizeStreamingUrl("file:///C:/secret.txt"), /HTTPS/);
assert.throws(() => normalizeStreamingUrl("https://user:password@example.com"), /credentials/);

const appDataPath = path.join(process.cwd(), "scripts", "artifacts", "streaming-profile-test");
const launch = createStreamingLaunch({
  browser,
  appDataPath,
  url: "https://bitmovin.com/demos/drm/"
});
const forbiddenSwitches = ["--no-sandbox", "--disable-web-security", "--remote-debugging-port", "--user-agent"];
for (const forbidden of forbiddenSwitches) {
  assert(!launch.args.some((argument) => argument.startsWith(forbidden)), `${forbidden} must not be used for protected playback.`);
}
assert(launch.args.includes("--start-maximized"));
assert(launch.args.includes("--app=https://bitmovin.com/demos/drm/"));
assert(!launch.args.includes("--new-window"));
assert(launch.args.some((argument) => argument.startsWith("--user-data-dir=")));
assert.equal(launch.url, "https://bitmovin.com/demos/drm/");

console.log(JSON.stringify({
  passed: true,
  browser: browser.name,
  executable: browser.path,
  profile: launch.profilePath,
  basePresentation: "app",
  windowsPresentation: "owned-overlay",
  secureUrlOnly: true,
  forbiddenSwitchesAbsent: true
}, null, 2));
