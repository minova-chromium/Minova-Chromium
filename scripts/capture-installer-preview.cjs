"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const previewFile = path.join(root, "installer", "preview", "index.html");
const outputDirectory = path.join(root, "scripts", "artifacts", "installer-preview-1.0.2");
const previews = [
  { name: "minova-1.0.2-installer.png", screen: "installer", width: 940, height: 620 },
  { name: "minova-1.0.2-installing.png", screen: "progress", width: 940, height: 620 },
  { name: "minova-1.0.2-update-ready.png", screen: "update", width: 680, height: 520 }
];

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const preview of previews) {
    const window = new BrowserWindow({
      width: preview.width,
      height: preview.height,
      show: false,
      frame: false,
      resizable: false,
      backgroundColor: "#060a10",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await window.loadFile(previewFile, { query: { screen: preview.screen } });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDirectory, preview.name), image.toPNG());
    window.destroy();
  }

  process.stdout.write(`${outputDirectory}\n`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
