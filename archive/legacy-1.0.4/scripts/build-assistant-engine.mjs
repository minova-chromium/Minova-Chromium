import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "src", "assistant");
const outputDirectory = path.join(sourceDirectory, "generated");

await mkdir(outputDirectory, { recursive: true });

const common = {
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  logLevel: "info"
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["./src/assistant/engine-host.entry.js"],
    outfile: path.join(outputDirectory, "engine-host.js")
  }),
  build({
    ...common,
    entryPoints: ["./src/assistant/engine-worker.entry.js"],
    outfile: path.join(outputDirectory, "engine-worker.js")
  })
]);
