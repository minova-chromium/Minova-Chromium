import { calculateEqHeadroom, dbToGain } from "../shared/dsp.js";
import { normalizeSettings } from "../shared/schema.js";

const SUSPEND_DELAY_MS = 1800;
const PARAMETER_TIME_CONSTANT = 0.018;

function isPlaying(media) {
  return !media.paused && !media.ended && media.readyState > HTMLMediaElement.HAVE_NOTHING;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error || "Unknown audio error");
}

export class MediaAudioEngine {
  constructor(settings) {
    this.settings = normalizeSettings(settings);
    this.context = null;
    this.graph = null;
    this.sources = new WeakMap();
    this.sourceFailures = new WeakMap();
    this.registrations = new WeakMap();
    this.observedMedia = new Set();
    this.connectedMedia = new Set();
    this.activeMedia = new Set();
    this.suspendTimer = null;
    this.lastError = "";
    this.lastWarning = "";
    this.currentHeadroom = { maxBoostDb: 0, preampDb: 0 };
  }

  registerMedia(media) {
    if (!(media instanceof HTMLMediaElement) || this.registrations.has(media)) return;

    const onPlay = () => {
      this.activeMedia.add(media);
      this.activateMedia(media).catch((error) => {
        this.lastError = describeError(error);
      });
    };
    const onStop = () => {
      this.activeMedia.delete(media);
      this.scheduleSuspend();
    };
    const onStateChange = () => {
      if (isPlaying(media)) onPlay();
      else onStop();
    };
    const listeners = {
      play: onPlay,
      playing: onPlay,
      pause: onStop,
      ended: onStop,
      emptied: onStop,
      abort: onStop,
      volumechange: onStateChange
    };

    for (const [eventName, listener] of Object.entries(listeners)) {
      media.addEventListener(eventName, listener, { passive: true });
    }
    this.registrations.set(media, listeners);
    this.observedMedia.add(media);

    if (isPlaying(media)) queueMicrotask(onPlay);
  }

  unregisterMedia(media) {
    const listeners = this.registrations.get(media);
    if (listeners) {
      for (const [eventName, listener] of Object.entries(listeners)) {
        media.removeEventListener(eventName, listener);
      }
      this.registrations.delete(media);
    }

    this.observedMedia.delete(media);
    this.activeMedia.delete(media);
    const source = this.sources.get(media);
    if (source && this.connectedMedia.has(media)) {
      try {
        source.disconnect();
      } catch {}
      this.connectedMedia.delete(media);
    }
    this.scheduleSuspend();
  }

  async activateMedia(media) {
    clearTimeout(this.suspendTimer);
    this.suspendTimer = null;

    if (!this.context && !this.settings.enabled) return;
    if (!this.sources.has(media) && !this.canAttachMedia(media)) return;
    this.ensureGraph();

    if (this.settings.enabled || this.sources.has(media)) {
      if (!this.connectMedia(media)) {
        this.scheduleSuspend();
        return;
      }
    }

    if (this.sources.has(media) && this.context.state !== "running") {
      await this.context.resume();
    }
  }

  ensureGraph() {
    if (this.context) return;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is not supported on this page.");

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
    const outputGain = context.createGain();
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
    previous.connect(outputGain);
    outputGain.connect(limiter);
    limiter.connect(wet);
    wet.connect(context.destination);

    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;

    this.context = context;
    this.graph = {
      input,
      dry,
      compressor,
      makeup,
      eqPreamp,
      filters,
      outputGain,
      limiter,
      wet
    };
    this.applySettings(true);
  }

  connectMedia(media) {
    if (this.sourceFailures.has(media)) return false;
    let source = this.sources.get(media);
    if (!source) {
      try {
        source = this.context.createMediaElementSource(media);
        this.sources.set(media, source);
      } catch (error) {
        this.sourceFailures.set(media, error);
        this.lastError = `This media element cannot be attached: ${describeError(error)}`;
        return false;
      }
    }

    if (!this.connectedMedia.has(media)) {
      source.connect(this.graph.input);
      this.connectedMedia.add(media);
    }

    return true;
  }

  canAttachMedia(media) {
    if (media.mediaKeys) {
      this.lastWarning = "Protected DRM media is left on its native audio path.";
      return false;
    }
    if (media.srcObject) return true;
    const source = media.currentSrc || media.src;
    if (!source || source.startsWith("blob:") || source.startsWith("data:")) return true;
    try {
      const url = new URL(source, location.href);
      if (url.origin !== location.origin && !media.crossOrigin) {
        this.lastWarning = "Cross-origin media without CORS was left on its native audio path.";
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  updateSettings(settings) {
    this.settings = normalizeSettings(settings);
    if (this.context) this.applySettings(false);

    if (this.settings.enabled) {
      for (const media of this.activeMedia) {
        this.activateMedia(media).catch((error) => {
          this.lastError = describeError(error);
        });
      }
    }
  }

  applySettings(initial = false) {
    if (!this.graph || !this.context) return;
    const now = this.context.currentTime;
    const {
      compressor,
      equalizer,
      outputGainDb,
      enabled,
      bypass
    } = this.settings;
    const processed = enabled && !bypass;

    this.setParameter(this.graph.wet.gain, processed ? 1 : 0, now, initial);
    this.setParameter(this.graph.dry.gain, processed ? 0 : 1, now, initial);

    this.setParameter(
      this.graph.compressor.threshold,
      compressor.enabled ? compressor.thresholdDb : 0,
      now,
      initial
    );
    this.setParameter(
      this.graph.compressor.knee,
      compressor.enabled ? compressor.kneeDb : 0,
      now,
      initial
    );
    this.setParameter(
      this.graph.compressor.ratio,
      compressor.enabled ? compressor.ratio : 1,
      now,
      initial
    );
    this.setParameter(
      this.graph.compressor.attack,
      compressor.attackSeconds,
      now,
      initial
    );
    this.setParameter(
      this.graph.compressor.release,
      compressor.releaseSeconds,
      now,
      initial
    );
    this.setParameter(
      this.graph.makeup.gain,
      dbToGain(compressor.enabled ? compressor.makeupGainDb : 0),
      now,
      initial
    );

    equalizer.bands.forEach((band, index) => {
      const filter = this.graph.filters[index];
      this.setParameter(filter.frequency, band.frequencyHz, now, initial);
      this.setParameter(filter.Q, band.q, now, initial);
      this.setParameter(filter.gain, equalizer.enabled ? band.gainDb : 0, now, initial);
    });

    this.currentHeadroom = calculateEqHeadroom(
      equalizer,
      this.context.sampleRate
    );
    this.setParameter(
      this.graph.eqPreamp.gain,
      dbToGain(equalizer.enabled ? this.currentHeadroom.preampDb : 0),
      now,
      initial
    );
    this.setParameter(
      this.graph.outputGain.gain,
      dbToGain(outputGainDb),
      now,
      initial
    );
  }

  setParameter(parameter, value, now, initial) {
    parameter.cancelScheduledValues(now);
    if (initial) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, PARAMETER_TIME_CONSTANT);
  }

  scheduleSuspend() {
    clearTimeout(this.suspendTimer);
    if (!this.context || this.hasActiveAttachedMedia()) return;
    this.suspendTimer = setTimeout(() => {
      if (!this.hasActiveAttachedMedia() && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, SUSPEND_DELAY_MS);
  }

  hasActiveAttachedMedia() {
    for (const media of this.activeMedia) {
      if (this.sources.has(media)) return true;
    }
    return false;
  }

  getStatus() {
    return {
      enabled: this.settings.enabled,
      bypass: this.settings.bypass,
      contextState: this.context?.state || "not-created",
      observedMediaCount: this.observedMedia.size,
      activeMediaCount: this.activeMedia.size,
      attachedMediaCount: this.connectedMedia.size,
      compressorReductionDb: this.graph?.compressor.reduction || 0,
      headroomDb: this.currentHeadroom.preampDb,
      maxEqBoostDb: this.currentHeadroom.maxBoostDb,
      warning: this.lastWarning,
      error: this.lastError
    };
  }

  async destroy() {
    clearTimeout(this.suspendTimer);
    for (const media of [...this.observedMedia]) this.unregisterMedia(media);
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.graph = null;
  }
}
