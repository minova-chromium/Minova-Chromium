const AUDIO_STUDIO_SCHEMA_VERSION = 1;

const DEFAULT_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const DEFAULT_AUDIO_STUDIO_SETTINGS = {
  schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
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

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAudioStudioSettings(value = {}) {
  const compressor = value.compressor || {};
  const equalizer = value.equalizer || {};
  const sourceBands = Array.isArray(equalizer.bands) ? equalizer.bands : [];
  return {
    schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
    enabled: normalizeBoolean(value.enabled, DEFAULT_AUDIO_STUDIO_SETTINGS.enabled),
    bypass: normalizeBoolean(value.bypass, DEFAULT_AUDIO_STUDIO_SETTINGS.bypass),
    compressor: {
      enabled: normalizeBoolean(compressor.enabled, DEFAULT_AUDIO_STUDIO_SETTINGS.compressor.enabled),
      thresholdDb: clamp(compressor.thresholdDb, -60, 0, -18),
      kneeDb: clamp(compressor.kneeDb, 0, 40, 18),
      ratio: clamp(compressor.ratio, 1, 20, 2.2),
      attackSeconds: clamp(compressor.attackSeconds, 0, 1, 0.025),
      releaseSeconds: clamp(compressor.releaseSeconds, 0, 1, 0.25),
      makeupGainDb: clamp(compressor.makeupGainDb, 0, 12, 2.5)
    },
    equalizer: {
      enabled: normalizeBoolean(equalizer.enabled, DEFAULT_AUDIO_STUDIO_SETTINGS.equalizer.enabled),
      autoHeadroom: normalizeBoolean(equalizer.autoHeadroom, true),
      safetyMarginDb: clamp(equalizer.safetyMarginDb, 0, 6, 1),
      bands: DEFAULT_FREQUENCIES.map((frequencyHz, index) => {
        const band = sourceBands[index] || {};
        return {
          id: `band-${index + 1}`,
          frequencyHz: clamp(band.frequencyHz, 20, 20000, frequencyHz),
          gainDb: clamp(band.gainDb, -12, 12, 0),
          q: clamp(band.q, 0.1, 18, 1.1)
        };
      })
    },
    outputGainDb: clamp(value.outputGainDb, -12, 12, 0)
  };
}

function presetConfig(gains, overrides = {}) {
  const settings = normalizeAudioStudioSettings({
    ...DEFAULT_AUDIO_STUDIO_SETTINGS,
    compressor: {
      ...DEFAULT_AUDIO_STUDIO_SETTINGS.compressor,
      ...(overrides.compressor || {})
    },
    equalizer: {
      ...DEFAULT_AUDIO_STUDIO_SETTINGS.equalizer,
      ...(overrides.equalizer || {}),
      bands: DEFAULT_AUDIO_STUDIO_SETTINGS.equalizer.bands.map((band, index) => ({
        ...band,
        gainDb: gains[index] || 0
      }))
    },
    outputGainDb: overrides.outputGainDb || 0
  });
  return {
    compressor: settings.compressor,
    equalizer: settings.equalizer,
    outputGainDb: settings.outputGainDb
  };
}

const BUILT_IN_AUDIO_PRESETS = [
  {
    id: "builtin-flat",
    name: "Flat",
    builtIn: true,
    config: presetConfig([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  },
  {
    id: "builtin-bass-boost",
    name: "Bass Boost",
    builtIn: true,
    config: presetConfig([4.5, 4, 2.5, 1, 0, -0.5, 0, 0.5, 0, 0], {
      compressor: { thresholdDb: -20, ratio: 2.4, attackSeconds: 0.03, releaseSeconds: 0.3 }
    })
  },
  {
    id: "builtin-vocal-clarity",
    name: "Vocal Clarity",
    builtIn: true,
    config: presetConfig([-1.5, -1, -0.5, -1, -0.5, 1, 2.8, 2.2, 0.8, 0], {
      compressor: { thresholdDb: -19, kneeDb: 20, ratio: 2, attackSeconds: 0.02, releaseSeconds: 0.22 }
    })
  },
  {
    id: "builtin-night-mode",
    name: "Night Mode",
    builtIn: true,
    config: presetConfig([-2, -1.5, -0.5, 0, 0.5, 1, 1.5, 0.5, -1, -2], {
      compressor: { thresholdDb: -26, kneeDb: 24, ratio: 3.5, attackSeconds: 0.018, releaseSeconds: 0.32, makeupGainDb: 4 }
    })
  }
].map((preset) => ({
  schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...preset
}));

const DEFAULT_AUDIO_STUDIO_STORE = {
  schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
  revision: 0,
  settings: clone(DEFAULT_AUDIO_STUDIO_SETTINGS),
  presets: clone(BUILT_IN_AUDIO_PRESETS),
  activePresetId: "builtin-flat"
};

function normalizePreset(value) {
  const id = String(value?.id || "").trim().slice(0, 80);
  const name = String(value?.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!id || !name) return null;
  const settings = normalizeAudioStudioSettings(value.config || {});
  return {
    schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
    id,
    name,
    builtIn: Boolean(value.builtIn),
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    config: {
      compressor: settings.compressor,
      equalizer: settings.equalizer,
      outputGainDb: settings.outputGainDb
    }
  };
}

function normalizeAudioStudioStore(value = {}) {
  const builtInIds = new Set(BUILT_IN_AUDIO_PRESETS.map((preset) => preset.id));
  const customPresets = (Array.isArray(value.presets) ? value.presets : [])
    .map(normalizePreset)
    .filter((preset) => preset && !preset.builtIn && !builtInIds.has(preset.id))
    .slice(0, 100);
  const presets = [...clone(BUILT_IN_AUDIO_PRESETS), ...customPresets];
  const activePresetId = presets.some((preset) => preset.id === value.activePresetId)
    ? String(value.activePresetId)
    : null;
  return {
    schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    settings: normalizeAudioStudioSettings(value.settings),
    presets,
    activePresetId
  };
}

function applyAudioStudioPreset(store, presetId) {
  const current = normalizeAudioStudioStore(store);
  const preset = current.presets.find((entry) => entry.id === String(presetId));
  if (!preset) throw new Error("That audio preset is unavailable.");
  current.settings = normalizeAudioStudioSettings({
    ...current.settings,
    ...clone(preset.config)
  });
  current.activePresetId = preset.id;
  current.revision += 1;
  return current;
}

function saveAudioStudioPreset(store, name, settings, presetId = null) {
  const current = normalizeAudioStudioStore(store);
  const cleanName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!cleanName) throw new Error("Enter a name for this preset.");
  const now = new Date().toISOString();
  const normalized = normalizeAudioStudioSettings(settings);
  const config = {
    compressor: normalized.compressor,
    equalizer: normalized.equalizer,
    outputGainDb: normalized.outputGainDb
  };
  let target = current.presets.find((entry) => entry.id === String(presetId) && !entry.builtIn);
  if (target) {
    target.name = cleanName;
    target.config = config;
    target.updatedAt = now;
  } else {
    target = {
      schemaVersion: AUDIO_STUDIO_SCHEMA_VERSION,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanName,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
      config
    };
    current.presets.push(target);
  }
  current.settings = normalized;
  current.activePresetId = target.id;
  current.revision += 1;
  return current;
}

function deleteAudioStudioPreset(store, presetId) {
  const current = normalizeAudioStudioStore(store);
  const preset = current.presets.find((entry) => entry.id === String(presetId));
  if (!preset || preset.builtIn) throw new Error("Built-in presets cannot be deleted.");
  current.presets = current.presets.filter((entry) => entry.id !== preset.id);
  if (current.activePresetId === preset.id) current.activePresetId = null;
  current.revision += 1;
  return current;
}

const TWO_PI = Math.PI * 2;

function peakingMagnitudeDb({ sampleRate, centerFrequencyHz, q, gainDb, evaluationFrequencyHz }) {
  const nyquist = sampleRate / 2;
  const center = Math.min(nyquist * 0.999, Math.max(1, centerFrequencyHz));
  const evaluation = Math.min(nyquist * 0.999, Math.max(1, evaluationFrequencyHz));
  const amplitude = 10 ** (gainDb / 40);
  const omega0 = TWO_PI * center / sampleRate;
  const alpha = Math.sin(omega0) / (2 * Math.max(0.0001, q));
  const cosine0 = Math.cos(omega0);
  const b0 = 1 + alpha * amplitude;
  const b1 = -2 * cosine0;
  const b2 = 1 - alpha * amplitude;
  const a0 = 1 + alpha / amplitude;
  const a1 = -2 * cosine0;
  const a2 = 1 - alpha / amplitude;
  const omega = TWO_PI * evaluation / sampleRate;
  const numeratorReal = b0 + b1 * Math.cos(omega) + b2 * Math.cos(omega * 2);
  const numeratorImaginary = -b1 * Math.sin(omega) - b2 * Math.sin(omega * 2);
  const denominatorReal = a0 + a1 * Math.cos(omega) + a2 * Math.cos(omega * 2);
  const denominatorImaginary = -a1 * Math.sin(omega) - a2 * Math.sin(omega * 2);
  const numerator = Math.hypot(numeratorReal, numeratorImaginary);
  const denominator = Math.max(Number.EPSILON, Math.hypot(denominatorReal, denominatorImaginary));
  return 20 * Math.log10(Math.max(Number.EPSILON, numerator / denominator));
}

function calculateAudioStudioHeadroom(equalizer, sampleRate = 48000, pointCount = 512) {
  const normalized = normalizeAudioStudioSettings({ equalizer }).equalizer;
  if (!normalized.enabled) return { maxBoostDb: 0, preampDb: 0 };
  const maximumFrequency = Math.min(20000, sampleRate / 2 * 0.999);
  let maxBoostDb = 0;
  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / (pointCount - 1);
    const frequency = 20 * (maximumFrequency / 20) ** progress;
    const combinedDb = normalized.bands.reduce((total, band) => total + peakingMagnitudeDb({
      sampleRate,
      centerFrequencyHz: band.frequencyHz,
      q: band.q,
      gainDb: band.gainDb,
      evaluationFrequencyHz: frequency
    }), 0);
    maxBoostDb = Math.max(maxBoostDb, combinedDb);
  }
  maxBoostDb = Math.max(0, Math.round(maxBoostDb * 100) / 100);
  return {
    maxBoostDb,
    preampDb: maxBoostDb > 0 && normalized.autoHeadroom
      ? -(maxBoostDb + normalized.safetyMarginDb)
      : 0
  };
}

function audioStudioFrameRuntime(payload) {
  const VERSION = 1;
  const SUSPEND_DELAY_MS = 1800;
  const PARAMETER_TIME_CONSTANT = 0.018;
  const drmHosts = /(^|\.)(netflix\.com|disneyplus\.com|hulu\.com|max\.com|hbomax\.com|primevideo\.com|paramountplus\.com|peacocktv\.com|tv\.apple\.com)$/i;
  const dbToGain = (decibels) => 10 ** (Number(decibels || 0) / 20);
  const isPlaying = (media) => !media.paused && !media.ended && media.readyState > 0;
  const describeError = (error) => error?.message || String(error || "Unknown audio error");

  let state = globalThis.__minovaAudioStudio;
  if (state?.version === VERSION && typeof state.setConfiguration === "function") {
    state.setConfiguration(payload);
    state.scan(document);
    return state.getStatus();
  }

  state = {
    version: VERSION,
    settings: payload.settings,
    boost: payload.boost,
    headroomDb: payload.headroomDb,
    context: null,
    graph: null,
    sources: new WeakMap(),
    connected: new WeakSet(),
    registered: new WeakMap(),
    observed: new Set(),
    active: new Set(),
    observers: new Map(),
    suspendTimer: null,
    warning: "",
    error: ""
  };

  state.setParameter = (parameter, value, initial = false) => {
    if (!state.context) return;
    const now = state.context.currentTime;
    parameter.cancelScheduledValues(now);
    if (initial) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, PARAMETER_TIME_CONSTANT);
  };

  state.ensureGraph = () => {
    if (state.context) return true;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) {
      state.error = "Web Audio is unavailable on this page.";
      return false;
    }
    const context = new Context({ latencyHint: "playback" });
    const input = context.createGain();
    const dry = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const makeup = context.createGain();
    const eqPreamp = context.createGain();
    const filters = Array.from({ length: 10 }, () => {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      return filter;
    });
    const output = context.createGain();
    const limiter = context.createDynamicsCompressor();
    const wet = context.createGain();

    input.connect(dry);
    dry.connect(context.destination);
    input.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(eqPreamp);
    let previous = eqPreamp;
    for (const filter of filters) {
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(output);
    output.connect(limiter);
    limiter.connect(wet);
    wet.connect(context.destination);
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    state.context = context;
    state.graph = { input, dry, compressor, makeup, eqPreamp, filters, output, limiter, wet };

    const legacy = globalThis.__minovaAudioBoost;
    if (legacy && legacy !== state && Array.isArray(legacy.entries)) {
      legacy.observer?.disconnect?.();
      for (const entry of legacy.entries) {
        try {
          entry.gain.disconnect();
          entry.gain.gain.value = 1;
          entry.gain.connect(input);
          state.sources.set(entry.element, entry.source);
          state.connected.add(entry.element);
        } catch {}
      }
    }
    state.applyConfiguration(true);
    return true;
  };

  state.applyConfiguration = (initial = false) => {
    if (!state.graph || !state.context) return;
    const settings = state.settings;
    const processed = settings.enabled && !settings.bypass;
    const compressor = settings.compressor;
    const equalizer = settings.equalizer;
    state.setParameter(state.graph.dry.gain, processed ? 0 : 1, initial);
    state.setParameter(state.graph.wet.gain, processed ? 1 : 0, initial);
    state.setParameter(state.graph.compressor.threshold, compressor.enabled ? compressor.thresholdDb : 0, initial);
    state.setParameter(state.graph.compressor.knee, compressor.enabled ? compressor.kneeDb : 0, initial);
    state.setParameter(state.graph.compressor.ratio, compressor.enabled ? compressor.ratio : 1, initial);
    state.setParameter(state.graph.compressor.attack, compressor.attackSeconds, initial);
    state.setParameter(state.graph.compressor.release, compressor.releaseSeconds, initial);
    state.setParameter(state.graph.makeup.gain, dbToGain(compressor.enabled ? compressor.makeupGainDb : 0), initial);
    equalizer.bands.forEach((band, index) => {
      const filter = state.graph.filters[index];
      state.setParameter(filter.frequency, band.frequencyHz, initial);
      state.setParameter(filter.Q, band.q, initial);
      state.setParameter(filter.gain, equalizer.enabled ? band.gainDb : 0, initial);
    });
    state.setParameter(state.graph.eqPreamp.gain, dbToGain(equalizer.enabled ? state.headroomDb : 0), initial);
    const boostedOutputDb = settings.outputGainDb + 20 * Math.log10(Math.max(1, state.boost));
    state.setParameter(state.graph.output.gain, dbToGain(boostedOutputDb), initial);
  };

  state.canAttach = (media) => {
    if (drmHosts.test(location.hostname) || media.mediaKeys) {
      state.warning = "Protected streaming audio stays on its native playback path.";
      return false;
    }
    if (media.srcObject) return true;
    const sourceValue = media.currentSrc || media.src || "";
    if (!sourceValue || /^(blob:|data:)/i.test(sourceValue)) return true;
    try {
      const sourceUrl = new URL(sourceValue, location.href);
      if (sourceUrl.origin !== location.origin && !media.crossOrigin) {
        state.warning = "This cross-origin player does not permit safe audio processing.";
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  state.connect = (media) => {
    if (state.connected.has(media)) return true;
    if (!state.canAttach(media) || !state.ensureGraph()) return false;
    let source = state.sources.get(media);
    if (!source) {
      try {
        source = state.context.createMediaElementSource(media);
        state.sources.set(media, source);
      } catch (error) {
        state.error = `Audio Studio could not attach this player: ${describeError(error)}`;
        return false;
      }
    }
    source.connect(state.graph.input);
    state.connected.add(media);
    return true;
  };

  state.scheduleSuspend = () => {
    clearTimeout(state.suspendTimer);
    state.suspendTimer = setTimeout(() => {
      const attachedPlaying = [...state.active].some((media) => state.sources.has(media) && isPlaying(media));
      if (!attachedPlaying && state.context?.state === "running") state.context.suspend().catch(() => {});
    }, SUSPEND_DELAY_MS);
  };

  state.activate = async (media) => {
    clearTimeout(state.suspendTimer);
    state.active.add(media);
    if (!state.settings.enabled && !state.sources.has(media)) return;
    if (!state.connect(media)) return;
    if (state.context?.state !== "running") await state.context.resume().catch(() => {});
  };

  state.register = (media) => {
    if (!(media instanceof HTMLMediaElement) || state.registered.has(media)) return;
    const onPlay = () => state.activate(media).catch((error) => { state.error = describeError(error); });
    const onStop = () => { state.active.delete(media); state.scheduleSuspend(); };
    const listeners = { play: onPlay, playing: onPlay, pause: onStop, ended: onStop, emptied: onStop, abort: onStop };
    for (const [name, listener] of Object.entries(listeners)) media.addEventListener(name, listener, { passive: true });
    state.registered.set(media, listeners);
    state.observed.add(media);
    if (isPlaying(media)) queueMicrotask(onPlay);
  };

  state.observeRoot = (root) => {
    if (!root || state.observers.has(root)) return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) state.scan(node);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    state.observers.set(root, observer);
  };

  state.scan = (root) => {
    if (!root) return;
    if (root instanceof HTMLMediaElement) state.register(root);
    if (root.querySelectorAll) {
      for (const media of root.querySelectorAll("audio, video")) state.register(media);
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          state.observeRoot(element.shadowRoot);
          state.scan(element.shadowRoot);
        }
      }
    }
  };

  state.setConfiguration = (next) => {
    state.settings = next.settings;
    state.boost = next.boost;
    state.headroomDb = next.headroomDb;
    state.applyConfiguration(false);
    if (state.settings.enabled) {
      for (const media of state.active) state.activate(media).catch(() => {});
    }
  };

  state.getStatus = () => ({
    observedMediaCount: state.observed.size,
    activeMediaCount: [...state.active].filter(isPlaying).length,
    attachedMediaCount: [...state.observed].filter((media) => state.sources.has(media)).length,
    contextState: state.context?.state || "idle",
    compressorReductionDb: Number(state.graph?.compressor.reduction || 0),
    enabled: state.settings.enabled,
    bypass: state.settings.bypass,
    boost: state.boost,
    warning: state.warning,
    error: state.error
  });

  globalThis.__minovaAudioStudio = state;
  globalThis.__minovaAudioBoost = state;
  state.observeRoot(document.documentElement || document);
  state.scan(document);
  return state.getStatus();
}

function buildAudioStudioInjection(settings, boost = 1) {
  const normalized = normalizeAudioStudioSettings(settings);
  const headroom = calculateAudioStudioHeadroom(normalized.equalizer);
  const payload = {
    settings: normalized,
    boost: clamp(boost, 1, 3, 1),
    headroomDb: headroom.preampDb
  };
  return `(${audioStudioFrameRuntime.toString()})(${JSON.stringify(payload)})`;
}

module.exports = {
  AUDIO_STUDIO_SCHEMA_VERSION,
  DEFAULT_AUDIO_STUDIO_SETTINGS,
  DEFAULT_AUDIO_STUDIO_STORE,
  BUILT_IN_AUDIO_PRESETS,
  normalizeAudioStudioSettings,
  normalizeAudioStudioStore,
  applyAudioStudioPreset,
  saveAudioStudioPreset,
  deleteAudioStudioPreset,
  calculateAudioStudioHeadroom,
  buildAudioStudioInjection
};
