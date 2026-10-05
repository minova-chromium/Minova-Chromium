export const SCHEMA_VERSION = 1;

export const DEFAULT_FREQUENCIES = [
  31,
  62,
  125,
  250,
  500,
  1000,
  2000,
  4000,
  8000,
  16000
];

export const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  bypass: false,
  compressor: {
    enabled: true,
    thresholdDb: -18,
    kneeDb: 18,
    ratio: 2.2,
    attackSeconds: 0.025,
    releaseSeconds: 0.25,
    makeupGainDb: 2.5
  },
  equalizer: {
    enabled: true,
    autoHeadroom: true,
    safetyMarginDb: 1,
    bands: DEFAULT_FREQUENCIES.map((frequencyHz, index) => ({
      id: `band-${index + 1}`,
      frequencyHz,
      gainDb: 0,
      q: 1.1
    }))
  },
  outputGainDb: 0
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPresetConfig(gains, overrides = {}) {
  const settings = clone(DEFAULT_SETTINGS);
  settings.equalizer.bands = settings.equalizer.bands.map((band, index) => ({
    ...band,
    gainDb: gains[index] ?? 0
  }));
  Object.assign(settings.compressor, overrides.compressor || {});
  Object.assign(settings.equalizer, overrides.equalizer || {});
  settings.outputGainDb = overrides.outputGainDb ?? settings.outputGainDb;
  return {
    compressor: settings.compressor,
    equalizer: settings.equalizer,
    outputGainDb: settings.outputGainDb
  };
}

export const BUILT_IN_PRESETS = [
  {
    schemaVersion: SCHEMA_VERSION,
    id: "builtin-flat",
    name: "Flat",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: createPresetConfig([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  },
  {
    schemaVersion: SCHEMA_VERSION,
    id: "builtin-bass-boost",
    name: "Bass Boost",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: createPresetConfig([4.5, 4, 2.5, 1, 0, -0.5, 0, 0.5, 0, 0], {
      compressor: {
        thresholdDb: -20,
        ratio: 2.4,
        attackSeconds: 0.03,
        releaseSeconds: 0.3
      }
    })
  },
  {
    schemaVersion: SCHEMA_VERSION,
    id: "builtin-vocal-clarity",
    name: "Vocal Clarity",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: createPresetConfig([-1.5, -1, -0.5, -1, -0.5, 1, 2.8, 2.2, 0.8, 0], {
      compressor: {
        thresholdDb: -19,
        kneeDb: 20,
        ratio: 2,
        attackSeconds: 0.02,
        releaseSeconds: 0.22
      }
    })
  },
  {
    schemaVersion: SCHEMA_VERSION,
    id: "builtin-night-mode",
    name: "Night Mode",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: createPresetConfig([-2, -1.5, -0.5, 0, 0.5, 1, 1.5, 0.5, -1, -2], {
      compressor: {
        thresholdDb: -26,
        kneeDb: 24,
        ratio: 3.5,
        attackSeconds: 0.018,
        releaseSeconds: 0.32,
        makeupGainDb: 4
      }
    })
  }
];

export function cloneDefaultSettings() {
  return clone(DEFAULT_SETTINGS);
}

export function cloneBuiltInPresets() {
  return clone(BUILT_IN_PRESETS);
}
