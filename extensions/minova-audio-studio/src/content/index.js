import { MediaAudioEngine } from "./audio-engine.js";
import { MediaObserver } from "./media-observer.js";
import { normalizeStore } from "../shared/schema.js";
import { ensureStore, STORE_KEY } from "../shared/storage.js";

let runtime = null;

export async function initializeAudioStudio() {
  if (runtime) return runtime;

  const store = await ensureStore();
  const engine = new MediaAudioEngine(store.settings);
  const observer = new MediaObserver({
    onMediaAdded: (media) => engine.registerMedia(media),
    onMediaRemoved: (media) => engine.unregisterMedia(media)
  });
  observer.start();

  const onStorageChanged = (changes, areaName) => {
    const nextValue = changes[STORE_KEY]?.newValue;
    if (areaName === "local" && nextValue) {
      engine.updateSettings(normalizeStore(nextValue).settings);
    }
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  const onMessage = (message, _sender, sendResponse) => {
    if (message?.type === "MINOVA_AUDIO_GET_STATUS") {
      sendResponse(engine.getStatus());
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  runtime = {
    engine,
    observer,
    async destroy() {
      observer.stop();
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.runtime.onMessage.removeListener(onMessage);
      await engine.destroy();
      runtime = null;
    }
  };
  return runtime;
}
