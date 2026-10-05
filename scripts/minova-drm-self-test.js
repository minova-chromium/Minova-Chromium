const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const executable = path.resolve(process.argv[2] || path.join(root, "node_modules", "electron", "dist", "electron.exe"));
const applicationArgument = process.argv[3] || ".";
const label = process.argv[4] || "native";
const artifacts = path.join(__dirname, "artifacts");
const outputPath = path.join(artifacts, `vmp-${label}.json`);
const profilePath = path.join(artifacts, `profile-vmp-${label}`);

fs.mkdirSync(artifacts, { recursive: true });
fs.rmSync(outputPath, { force: true });

const applicationArgs = applicationArgument === "-" ? [] : [applicationArgument];
const child = spawn(executable, applicationArgs, {
  cwd: root,
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    MINOVA_USER_DATA_PATH: profilePath,
    MINOVA_DRM_SELF_TEST_OUTPUT: outputPath
  }
});

const timeout = setTimeout(() => {
  child.kill();
  console.error("Minova's protected-content self-test timed out.");
  process.exitCode = 1;
}, 90000);

child.once("error", (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  clearTimeout(timeout);
  if (!fs.existsSync(outputPath)) {
    console.error(`Minova exited with code ${code} without writing ${outputPath}.`);
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = code === 0 && report.passed ? 0 : 1;
});
