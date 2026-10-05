const MEDIA_SELECTOR = "audio, video";
const SHADOW_RESCAN_INTERVAL_MS = 30000;

function isMediaElement(node) {
  return node instanceof HTMLAudioElement || node instanceof HTMLVideoElement;
}

export class MediaObserver {
  constructor({ onMediaAdded, onMediaRemoved }) {
    this.onMediaAdded = onMediaAdded;
    this.onMediaRemoved = onMediaRemoved;
    this.observers = new Map();
    this.knownShadowRoots = new WeakSet();
    this.shadowRescanTimer = null;
  }

  start() {
    this.observeRoot(document);
    this.scanTree(document, this.onMediaAdded, true);
    document.addEventListener("DOMContentLoaded", () => {
      this.scanTree(document, this.onMediaAdded, true);
    }, { once: true });
    this.scheduleShadowRescan();
  }

  observeRoot(root) {
    if (this.observers.has(root)) return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          this.scanTree(node, this.onMediaAdded, true);
        }
        for (const node of mutation.removedNodes) {
          this.scanTree(node, this.onMediaRemoved, false);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.observers.set(root, observer);
  }

  scanTree(root, callback, observeShadows) {
    if (!root) return;
    if (isMediaElement(root)) callback(root);

    if (root.querySelectorAll) {
      for (const media of root.querySelectorAll(MEDIA_SELECTOR)) callback(media);
    }

    if (root instanceof Element && root.shadowRoot) {
      this.handleShadowRoot(root.shadowRoot, callback, observeShadows);
    }
    if (root.querySelectorAll) {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          this.handleShadowRoot(element.shadowRoot, callback, observeShadows);
        }
      }
    }
  }

  handleShadowRoot(shadowRoot, callback, observeShadows) {
    if (observeShadows) {
      this.scanShadowRoot(shadowRoot);
      return;
    }
    this.scanTree(shadowRoot, callback, false);
    this.observers.get(shadowRoot)?.disconnect();
    this.observers.delete(shadowRoot);
    this.knownShadowRoots.delete(shadowRoot);
  }

  scanShadowRoot(shadowRoot) {
    if (this.knownShadowRoots.has(shadowRoot)) return;
    this.knownShadowRoots.add(shadowRoot);
    this.observeRoot(shadowRoot);
    this.scanTree(shadowRoot, this.onMediaAdded, true);
  }

  scheduleShadowRescan() {
    clearTimeout(this.shadowRescanTimer);
    this.shadowRescanTimer = setTimeout(() => {
      const rescan = () => {
        if (document.visibilityState !== "hidden") {
          for (const element of document.querySelectorAll("*")) {
            if (element.shadowRoot) this.scanShadowRoot(element.shadowRoot);
          }
        }
        this.scheduleShadowRescan();
      };
      if ("requestIdleCallback" in globalThis) {
        requestIdleCallback(rescan, { timeout: 2000 });
      } else {
        rescan();
      }
    }, SHADOW_RESCAN_INTERVAL_MS);
  }

  stop() {
    clearTimeout(this.shadowRescanTimer);
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
  }
}
