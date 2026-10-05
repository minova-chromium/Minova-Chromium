(() => {
  if (globalThis.__minovaAudioStudioBootstrapped) return;
  globalThis.__minovaAudioStudioBootstrapped = true;

  import(chrome.runtime.getURL("src/content/index.js"))
    .then(({ initializeAudioStudio }) => initializeAudioStudio())
    .catch((error) => {
      console.error("Minova Audio Studio could not initialize:", error);
    });
})();
