const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const executable = path.resolve(process.argv[2] || path.join(root, "node_modules", "electron", "dist", "electron.exe"));
const applicationArgument = process.argv[3] || ".";
const port = Number(process.argv[4] || 10127);
const label = process.argv[5] || `source-${port}`;
const artifacts = path.join(__dirname, "artifacts");
const profile = path.join(artifacts, `profile-${label}`);
const stdoutPath = path.join(artifacts, `${label}.stdout.log`);
const stderrPath = path.join(artifacts, `${label}.stderr.log`);

fs.mkdirSync(artifacts, { recursive: true });
if (process.env.MINOVA_TEST_EXTENSION_PATH) {
  fs.mkdirSync(profile, { recursive: true });
  const settingsPath = path.join(profile, "settings.json");
  const settings = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
    : {};
  settings.extensionPaths = Array.from(new Set([
    ...(Array.isArray(settings.extensionPaths) ? settings.extensionPaths : []),
    path.resolve(process.env.MINOVA_TEST_EXTENSION_PATH)
  ]));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
const args = applicationArgument === "-" ? [] : [applicationArgument];
args.push(`--remote-debugging-port=${port}`);
if (process.env.MINOVA_TEST_DISABLE_GPU === "1") args.push("--disable-gpu");

const stdout = fs.openSync(stdoutPath, "a");
const stderr = fs.openSync(stderrPath, "a");
const child = spawn(executable, args, {
  cwd: root,
  detached: true,
  windowsHide: process.env.MINOVA_TEST_VISIBLE !== "1",
  stdio: ["ignore", stdout, stderr],
  env: {
    ...process.env,
    MINOVA_USER_DATA_PATH: profile
  }
});

child.unref();
process.stdout.write(`${JSON.stringify({ pid: child.pid, executable, args, port, profile, stdoutPath, stderrPath }, null, 2)}\n`);
