import {
  BUILT_IN_PRESETS,
  DEFAULT_FREQUENCIES,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION
} from "./defaults.js";

export function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
}

export function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeCompressor(value = {}) {
  const fallback = DEFAULT_SETTINGS.compressor;
  return {
    enabled: normalizeBoolean(value.enabled, fallback.enabled),
    thresholdDb: clamp(value.thresholdDb, -60, 0, fallback.thresholdDb),
    kneeDb: clamp(value.kneeDb, 0, 40, fallback.kneeDb),
    ratio: clamp(value.ratio, 1, 20, fallback.ratio),
    attackSeconds: clamp(value.attackSeconds, 0, 1, fallback.attackSeconds),
    releaseSeconds: clamp(value.releaseSeconds, 0, 1, fallback.releaseSeconds),
    makeupGainDb: clamp(value.makeupGainDb, 0, 12, fallback.makeupGainDb)
  };
}

export function normalizeBand(value = {}, index = 0) {
  const fallbackFrequency = DEFAULT_FREQUENCIES[index] || DEFAULT_FREQUENCIES.at(-1);
  return {
    id: `band-${index + 1}`,
    frequencyHz: clamp(value.frequencyHz, 20, 20000, fallbackFrequency),
    gainDb: clamp(value.gainDb, -12, 12, 0),
    q: clamp(value.q, 0.1, 18, 1.1)
  };
}

export function normalizeEqualizer(value = {}) {
  const sourceBands = Array.isArray(value.bands) ? value.bands : [];
  return {
    enabled: normalizeBoolean(value.enabled, DEFAULT_SETTINGS.equalizer.enabled),
    autoHeadroom: normalizeBoolean(
      value.autoHeadroom,
      DEFAULT_SETTINGS.equalizer.autoHeadroom
    ),
    safetyMarginDb: clamp(
      value.safetyMarginDb,
      0,
      6,
      DEFAULT_SETTINGS.equalizer.safetyMarginDb
    ),
    bands: DEFAULT_FREQUENCIES.map((_, index) => normalizeBand(sourceBands[index], index))
  };
}

export function normalizeSettings(value = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: normalizeBoolean(value.enabled, DEFAULT_SETTINGS.enabled),
    bypass: normalizeBoolean(value.bypass, DEFAULT_SETTINGS.bypass),
    compressor: normalizeCompressor(value.compressor),
    equalizer: normalizeEqualizer(value.equalizer),
    outputGainDb: clamp(
      value.outputGainDb,
      -12,
      12,
      DEFAULT_SETTINGS.outputGainDb
    )
  };
}

export function extractPresetConfig(settings) {
  const normalized = normalizeSettings(settings);
  return {
    compressor: normalized.compressor,
    equalizer: normalized.equalizer,
    outputGainDb: normalized.outputGainDb
  };
}

export function applyPresetConfig(currentSettings, config = {}) {
  const current = normalizeSettings(currentSettings);
  return normalizeSettings({
    ...current,
    compressor: config.compressor,
    equalizer: config.equalizer,
    outputGainDb: config.outputGainDb
  });
}

export function normalizePreset(value = {}) {
  const now = new Date().toISOString();
  const id = String(value.id || "").trim().slice(0, 80);
  const name = String(value.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!id || !name) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    builtIn: Boolean(value.builtIn),
    createdAt: String(value.createdAt || now),
    updatedAt: String(value.updatedAt || now),
    config: extractPresetConfig(value.config || {})
  };
}

export function normalizeStore(value = {}) {
  const builtInIds = new Set(BUILT_IN_PRESETS.map((preset) => preset.id));
  const customPresets = (Array.isArray(value.presets) ? value.presets : [])
    .map(normalizePreset)
    .filter((preset) => preset && !builtInIds.has(preset.id))
    .slice(0, 100);
  const presets = [...cloneValue(BUILT_IN_PRESETS), ...customPresets];
  const requestedActiveId = String(value.activePresetId || "");
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    settings: normalizeSettings(value.settings),
    presets,
    activePresetId: presets.some((preset) => preset.id === requestedActiveId)
      ? requestedActiveId
      : null
  };
}
