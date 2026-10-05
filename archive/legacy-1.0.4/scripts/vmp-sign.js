const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function pythonCommand() {
  if (process.env.MINOVA_EVS_PYTHON) {
    return { command: process.env.MINOVA_EVS_PYTHON, prefix: [] };
  }
  return process.platform === "win32"
    ? { command: "py", prefix: ["-3"] }
    : { command: "python3", prefix: [] };
}

function signVmpPackage(targetDirectory) {
  const target = path.resolve(targetDirectory);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`VMP signing target is not a directory: ${target}`);
  }

  const { command, prefix } = pythonCommand();
  const result = spawnSync(command, [
    ...prefix,
    "-m",
    "castlabs_evs.vmp",
    "sign-pkg",
    target
  ], {
    stdio: "inherit",
    env: { ...process.env, EVS_NO_ASK: process.env.EVS_NO_ASK || "1" }
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Castlabs EVS VMP signing failed with exit code ${result.status}.`);
  }

  if (process.platform === "win32") {
    const signedExecutables = fs.readdirSync(target)
      .filter((filename) => filename.toLowerCase().endsWith(".exe"))
      .filter((filename) => fs.existsSync(path.join(target, `${filename}.sig`)));
    if (!signedExecutables.length) {
      throw new Error("Castlabs EVS completed without producing a matching Windows VMP signature file.");
    }
  }
}

if (require.main === module) {
  try {
    signVmpPackage(process.argv[2] || path.join("dist", "win-unpacked"));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { signVmpPackage };
