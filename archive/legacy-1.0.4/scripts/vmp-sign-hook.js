const fs = require("node:fs");
const path = require("node:path");
const { signVmpPackage } = require("./vmp-sign");

async function afterSign(context) {
  const staleDevelopmentSignature = path.join(context.appOutDir, "electron.exe.sig");
  if (context.electronPlatformName === "win32" && fs.existsSync(staleDevelopmentSignature)) {
    fs.rmSync(staleDevelopmentSignature, { force: true });
  }
  if (process.env.MINOVA_VMP_SIGN !== "1") return;
  if (context.electronPlatformName !== "win32") {
    throw new Error("Minova's automated VMP hook currently supports Windows builds only.");
  }
  signVmpPackage(context.appOutDir);
}

module.exports = afterSign;
module.exports.default = afterSign;
