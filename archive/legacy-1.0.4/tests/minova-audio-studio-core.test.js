const assert = require("node:assert/strict");
const {
  DEFAULT_AUDIO_STUDIO_STORE,
  normalizeAudioStudioSettings,
  normalizeAudioStudioStore,
  applyAudioStudioPreset,
  saveAudioStudioPreset,
  deleteAudioStudioPreset,
  calculateAudioStudioHeadroom,
  buildAudioStudioInjection
} = require("../src/audio-studio-core");

const normalized = normalizeAudioStudioSettings({
  compressor: { thresholdDb: -100, ratio: 99 },
  equalizer: { bands: [{ frequencyHz: 1, gainDb: 99, q: 99 }] },
  outputGainDb: 99
});
assert.equal(normalized.compressor.thresholdDb, -60);
assert.equal(normalized.compressor.ratio, 20);
assert.equal(normalized.equalizer.bands.length, 10);
assert.equal(normalized.equalizer.bands[0].frequencyHz, 20);
assert.equal(normalized.equalizer.bands[0].gainDb, 12);
assert.equal(normalized.equalizer.bands[0].q, 18);
assert.equal(normalized.outputGainDb, 12);

let store = normalizeAudioStudioStore(DEFAULT_AUDIO_STUDIO_STORE);
assert.equal(store.presets.length, 4);
store = applyAudioStudioPreset(store, "builtin-bass-boost");
assert.equal(store.activePresetId, "builtin-bass-boost");
assert.equal(store.settings.equalizer.bands[0].gainDb, 4.5);

store = saveAudioStudioPreset(store, "My speakers", store.settings);
const customId = store.activePresetId;
assert.match(customId, /^custom-/);
assert.equal(store.presets.find((preset) => preset.id === customId).name, "My speakers");
store = deleteAudioStudioPreset(store, customId);
assert.equal(store.presets.some((preset) => preset.id === customId), false);

const headroom = calculateAudioStudioHeadroom({
  ...store.settings.equalizer,
  enabled: true,
  autoHeadroom: true,
  safetyMarginDb: 1,
  bands: store.settings.equalizer.bands.map((band, index) => ({
    ...band,
    gainDb: index === 0 ? 6 : 0
  }))
});
assert(headroom.maxBoostDb >= 5.9);
assert(headroom.preampDb <= -6.9);

const injection = buildAudioStudioInjection(store.settings, 1.75);
assert.match(injection, /__minovaAudioStudio/);
assert.match(injection, /DynamicsCompressor/);
assert.match(injection, /createBiquadFilter/);
assert.match(injection, /"boost":1\.75/);
new Function(`return ${injection};`);

process.stdout.write(JSON.stringify({
  passed: true,
  builtInPresets: store.presets.length,
  headroom,
  injectionBytes: Buffer.byteLength(injection)
}, null, 2));
