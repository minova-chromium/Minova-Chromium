import { cloneBuiltInPresets, cloneDefaultSettings, SCHEMA_VERSION } from "./defaults.js";
import {
  applyPresetConfig,
  cloneValue,
  extractPresetConfig,
  normalizeSettings,
  normalizeStore
} from "./schema.js";

export const STORE_KEY = "minovaAudioStudio";

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function createId() {
  if (globalThis.crypto?.randomUUID) return `preset-${crypto.randomUUID()}`;
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeStore(store) {
  const normalized = normalizeStore({
    ...store,
    revision: (Number(store.revision) || 0) + 1
  });
  await storageSet({ [STORE_KEY]: normalized });
  return normalized;
}

export async function ensureStore() {
  const stored = (await storageGet(STORE_KEY))[STORE_KEY];
  const normalized = stored
    ? normalizeStore(stored)
    : {
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        settings: cloneDefaultSettings(),
        presets: cloneBuiltInPresets(),
        activePresetId: "builtin-flat"
      };

  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await storageSet({ [STORE_KEY]: normalized });
  }
  return cloneValue(normalized);
}

export async function setLiveSettings(settings, { preservePreset = false } = {}) {
  const store = await ensureStore();
  store.settings = normalizeSettings(settings);
  if (!preservePreset) store.activePresetId = null;
  return writeStore(store);
}

export async function applyPreset(presetId) {
  const store = await ensureStore();
  const preset = store.presets.find((entry) => entry.id === presetId);
  if (!preset) throw new Error("Preset not found.");
  store.settings = applyPresetConfig(store.settings, preset.config);
  store.activePresetId = preset.id;
  return writeStore(store);
}

export async function savePreset(name, settings, presetId = null) {
  const normalizedName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!normalizedName) throw new Error("Enter a preset name.");

  const store = await ensureStore();
  const existing = presetId
    ? store.presets.find((preset) => preset.id === presetId && !preset.builtIn)
    : null;
  const now = new Date().toISOString();
  const preset = {
    schemaVersion: SCHEMA_VERSION,
    id: existing?.id || createId(),
    name: normalizedName,
    builtIn: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    config: extractPresetConfig(settings)
  };

  store.presets = existing
    ? store.presets.map((entry) => entry.id === existing.id ? preset : entry)
    : [...store.presets, preset];
  store.settings = normalizeSettings(settings);
  store.activePresetId = preset.id;
  return writeStore(store);
}

export async function deletePreset(presetId) {
  const store = await ensureStore();
  const preset = store.presets.find((entry) => entry.id === presetId);
  if (!preset) return store;
  if (preset.builtIn) throw new Error("Built-in presets cannot be deleted.");

  store.presets = store.presets.filter((entry) => entry.id !== presetId);
  if (store.activePresetId === presetId) {
    const flat = store.presets.find((entry) => entry.id === "builtin-flat");
    store.settings = applyPresetConfig(store.settings, flat?.config);
    store.activePresetId = flat?.id || null;
  }
  return writeStore(store);
}
