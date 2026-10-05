import { ensureStore } from "../shared/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  ensureStore().catch((error) => {
    console.error("Minova Audio Studio could not initialize storage:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureStore().catch((error) => {
    console.error("Minova Audio Studio could not validate storage:", error);
  });
});
