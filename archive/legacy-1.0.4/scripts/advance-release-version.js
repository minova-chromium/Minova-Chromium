"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const expectedVersion = String(process.argv[2] || "").trim();
const dryRun = process.argv.includes("--dry-run");
const semanticVersion = /^(\d+)\.(\d+)\.(\d+)$/;

function nextPatchVersion(version) {
  const match = semanticVersion.exec(version);
  if (!match) {
    throw new Error(`Cannot automatically advance non-stable version "${version}".`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const packageData = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (expectedVersion && packageData.version !== expectedVersion) {
  throw new Error(
    `package.json changed during publishing: expected ${expectedVersion}, found ${packageData.version}.`
  );
}

const nextVersion = nextPatchVersion(packageData.version);
if (!dryRun) {
  packageData.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");
}

process.stdout.write(nextVersion);
