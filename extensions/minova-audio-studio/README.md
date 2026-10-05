# Minova Audio Studio for Chrome

Minova Chromium already includes Audio Studio as a native browser feature. This
Manifest V3 package is the standalone edition for people who want the same
normalizer, EQ, limiter, and preset workflow in Google Chrome or another
compatible Chromium browser.

Minova Audio Studio is a Manifest V3 extension that applies transparent dynamic
range compression and a protected 10-band parametric EQ to HTML `<audio>` and
`<video>` elements.

## Install

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `minova-audio-studio` folder.
5. Reload any media tabs that were already open before installation.
6. Pin **Minova Audio Studio** to the toolbar.

The extension is also loadable through `chrome://extensions` in Chromium-based
browsers after enabling Developer mode.

## Signal path

Each frame owns one lazily-created `AudioContext`:

```text
MediaElementSource(s)
  -> input bus
  -> DynamicsCompressor
  -> makeup gain
  -> automatic EQ headroom
  -> 10 peaking BiquadFilter nodes
  -> output gain
  -> -1 dB safety limiter
  -> destination
```

A dry path provides click-free global bypass. The flat preset has a 0 dB EQ
curve and therefore remains at exact unity gain. When bands are boosted, the
extension evaluates the combined biquad response over a logarithmic frequency
grid and applies only the attenuation needed for the highest peak plus the
configured safety margin.

## Normalizer ranges

The default profile is intentionally gentle:

| Parameter | Default | UI range |
| --- | ---: | ---: |
| Threshold | -18 dB | -60 to 0 dB |
| Knee | 18 dB | 0 to 40 dB |
| Ratio | 2.2:1 | 1:1 to 20:1 |
| Attack | 25 ms | 0 to 200 ms |
| Release | 250 ms | 0 to 1000 ms |
| Makeup gain | 2.5 dB | 0 to 12 dB |

These defaults preserve transients and use a broad knee and moderate release to
avoid obvious pumping. The final limiter is a protection stage, not a loudness
maximizer. A `DynamicsCompressorNode` does not measure LUFS and cannot by itself
guarantee equal perceived loudness between every source.

## Preset data

The extension stores one versioned document in `chrome.storage.local`:

```json
{
  "schemaVersion": 1,
  "revision": 4,
  "activePresetId": "preset-c1ad...",
  "settings": {
    "enabled": true,
    "bypass": false,
    "compressor": {
      "enabled": true,
      "thresholdDb": -18,
      "kneeDb": 18,
      "ratio": 2.2,
      "attackSeconds": 0.025,
      "releaseSeconds": 0.25,
      "makeupGainDb": 2.5
    },
    "equalizer": {
      "enabled": true,
      "autoHeadroom": true,
      "safetyMarginDb": 1,
      "bands": [
        {
          "id": "band-1",
          "frequencyHz": 31,
          "gainDb": 0,
          "q": 1.1
        }
      ]
    },
    "outputGainDb": 0
  },
  "presets": [
    {
      "schemaVersion": 1,
      "id": "preset-c1ad...",
      "name": "My headphones",
      "builtIn": false,
      "createdAt": "2026-07-27T12:00:00.000Z",
      "updatedAt": "2026-07-27T12:04:00.000Z",
      "config": {
        "compressor": {},
        "equalizer": {},
        "outputGainDb": 0
      }
    }
  ]
}
```

All values are normalized and clamped when read. Built-in presets are restored
from source on migration and cannot be overwritten or deleted.

## Performance

- The `AudioContext` is created only after media begins playing while processing
  is enabled.
- A frame shares one compressor and EQ chain across its media elements.
- The context suspends 1.8 seconds after its last attached media element stops.
- `MutationObserver` discovers dynamically inserted media.
- The content script runs in every eligible frame, including cross-origin
  iframes, so each frame processes its own media without DOM access violations.
- Open shadow roots are observed; a low-frequency idle scan catches roots
  attached to existing hosts after initial page load.

## Browser security limits

Web Audio deliberately outputs silence for some cross-origin media when the
server does not provide a compatible CORS response. The engine detects the
unsafe no-CORS case before attaching and leaves that element on its native audio
path. Encrypted EME/DRM playback is handled the same way. Closed shadow roots,
browser-internal pages, Chrome Web Store pages, and media rendered in a separate
application process cannot be intercepted by a normal extension. Minova
Streaming Mode uses a separate signed Edge surface, so this extension cannot
alter that protected audio path.

Processing the entire tab instead requires Chromium's `tabCapture` API, an
explicit user gesture, and an offscreen document. That is a different capture
architecture and may still be restricted for protected content.
