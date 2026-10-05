"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadAsar() {
  try {
    return require("@electron/asar");
  } catch {
    const store = path.resolve("node_modules/.pnpm");
    const packageDirectory = fs.readdirSync(store)
      .find((name) => name.startsWith("@electron+asar@"));
    if (!packageDirectory) throw new Error("@electron/asar is not installed.");
    return require(path.join(store, packageDirectory, "node_modules/@electron/asar"));
  }
}

const asar = loadAsar();

const archive = path.resolve(process.argv[2] || "dist/update/win-unpacked/resources/app.asar");
const read = (file) => asar.extractFile(archive, file).toString("utf8");
const css = read("src/styles.css");
const renderer = read("src/renderer.js");
const main = read("src/main.js");
const html = read("src/index.html");
const menuCss = read("src/quick-menu.css");
const menuRenderer = read("src/quick-menu.js");

assert.match(css, /grid-template-rows:\s*60px 42px minmax\(0, 1fr\)/);
assert.match(css, /\.app-shell\.safari-ui \.window-drag[\s\S]{0,300}-webkit-app-region:\s*drag/);
assert.match(css, /backdrop-filter:\s*blur\(36px\) saturate\(180%\)/);
assert.match(css, /--glass-specular:/);
assert.match(css, /border-radius:\s*14px/);
assert.match(css, /settings-section[\s\S]{0,400}border-radius:\s*16px/);
assert.match(renderer, /function initializeLiquidGlassInteraction/);
assert.match(renderer, /mode: document\.documentElement\.dataset\.theme/);
assert.match(main, /movable:\s*true/);
assert.match(main, /resizable:\s*true/);
assert.match(main, /thickFrame:\s*true/);
assert.match(main, /win\.setResizable\(true\)/);
assert.match(html, /styles\.css\?v=minova-liquid-glass-2/);
assert.ok(menuCss.includes(':root[data-theme="liquid-glass"] .menu-surface'));
assert.match(menuRenderer, /root\.dataset\.theme/);

process.stdout.write("packaged-liquid-glass=pass chrome-boundary=102px\n");
