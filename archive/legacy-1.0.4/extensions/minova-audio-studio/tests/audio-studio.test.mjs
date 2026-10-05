import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILT_IN_PRESETS, DEFAULT_SETTINGS } from "../src/shared/defaults.js";
import { calculateEqHeadroom, peakingMagnitudeDb } from "../src/shared/dsp.js";
import {
  applyPresetConfig,
  normalizeSettings,
  normalizeStore
} from "../src/shared/schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
assert.equal(manifest.content_scripts[0].all_frames, true);
assert.equal(manifest.background.type, "module");

const clamped = normalizeSettings({
  compressor: {
    thresholdDb: -999,
    kneeDb: 999,
    ratio: 0,
    attackSeconds: 9,
    releaseSeconds: -1,
    makeupGainDb: 99
  },
  equalizer: {
    bands: [{ frequencyHz: 1, gainDb: 50, q: 0 }]
  },
  outputGainDb: 99
});
assert.equal(clamped.compressor.thresholdDb, -60);
assert.equal(clamped.compressor.kneeDb, 40);
assert.equal(clamped.compressor.ratio, 1);
assert.equal(clamped.compressor.attackSeconds, 1);
assert.equal(clamped.compressor.releaseSeconds, 0);
assert.equal(clamped.compressor.makeupGainDb, 12);
assert.equal(clamped.equalizer.bands[0].frequencyHz, 20);
assert.equal(clamped.equalizer.bands[0].gainDb, 12);
assert.equal(clamped.equalizer.bands[0].q, 0.1);
assert.equal(clamped.outputGainDb, 12);
assert.equal(clamped.equalizer.bands.length, 10);

const flatHeadroom = calculateEqHeadroom(DEFAULT_SETTINGS.equalizer);
assert.deepEqual(flatHeadroom, { maxBoostDb: 0, preampDb: 0 });

const boostedEq = structuredClone(DEFAULT_SETTINGS.equalizer);
boostedEq.bands[5].frequencyHz = 1000;
boostedEq.bands[5].gainDb = 6;
boostedEq.bands[5].q = 1;
const boostedHeadroom = calculateEqHeadroom(boostedEq, 48000, 2048);
assert(boostedHeadroom.maxBoostDb > 5.95 && boostedHeadroom.maxBoostDb <= 6.01);
assert(boostedHeadroom.preampDb < -6.95 && boostedHeadroom.preampDb > -7.05);
assert(Math.abs(peakingMagnitudeDb({
  sampleRate: 48000,
  centerFrequencyHz: 1000,
  q: 1,
  gainDb: 6,
  evaluationFrequencyHz: 1000
}) - 6) < 0.001);

const restoredStore = normalizeStore({
  presets: [
    {
      id: "builtin-flat",
      name: "Tampered built-in",
      builtIn: false,
      config: {}
    },
    {
      id: "custom-one",
      name: "  Studio   monitors  ",
      config: {
        compressor: DEFAULT_SETTINGS.compressor,
        equalizer: boostedEq,
        outputGainDb: -1
      }
    }
  ],
  activePresetId: "custom-one"
});
assert.equal(restoredStore.presets.length, BUILT_IN_PRESETS.length + 1);
assert.equal(restoredStore.presets[0].name, "Flat");
assert.equal(restoredStore.presets.at(-1).name, "Studio monitors");
assert.equal(restoredStore.activePresetId, "custom-one");

const applied = applyPresetConfig(DEFAULT_SETTINGS, restoredStore.presets.at(-1).config);
assert.equal(applied.equalizer.bands[5].gainDb, 6);
assert.equal(applied.outputGainDb, -1);

const memory = {};
globalThis.chrome = {
  runtime: { lastError: null },
  storage: {
    local: {
      get(keys, callback) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(
          keyList.filter((key) => key in memory).map((key) => [key, memory[key]])
        ));
      },
      set(value, callback) {
        Object.assign(memory, structuredClone(value));
        callback();
      }
    }
  }
};

const storage = await import("../src/shared/storage.js");
let persisted = await storage.ensureStore();
assert.equal(persisted.activePresetId, "builtin-flat");
assert.equal(persisted.presets.length, BUILT_IN_PRESETS.length);

persisted = await storage.savePreset("  Night   listening ", boostedEq
  ? { ...DEFAULT_SETTINGS, equalizer: boostedEq }
  : DEFAULT_SETTINGS);
const customId = persisted.activePresetId;
assert(customId.startsWith("preset-"));
assert.equal(persisted.presets.at(-1).name, "Night listening");

persisted = await storage.applyPreset("builtin-vocal-clarity");
assert.equal(persisted.activePresetId, "builtin-vocal-clarity");
assert.equal(persisted.settings.equalizer.bands[6].gainDb, 2.8);

persisted = await storage.deletePreset(customId);
assert(!persisted.presets.some((preset) => preset.id === customId));
await assert.rejects(() => storage.deletePreset("builtin-flat"), /cannot be deleted/i);

console.log(JSON.stringify({
  passed: true,
  manifestV3: true,
  compressorClamping: true,
  parametricHeadroom: boostedHeadroom,
  builtInPresets: BUILT_IN_PRESETS.map((preset) => preset.name),
  presetCrud: true
}, null, 2));
