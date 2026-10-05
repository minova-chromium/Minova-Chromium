const params = new URLSearchParams(window.location.search);
const title = (params.get("title") || "YouTube Mini Player").trim();
const status = document.querySelector("#playerStatus");
const pinButton = document.querySelector("#pinButton");

document.querySelector("#playerTitle").textContent = title;

window.minovaPopout.onStatus((nextStatus) => {
  status.textContent = nextStatus.error || "Loading video...";
  status.classList.toggle("hidden", Boolean(nextStatus.ready));
});

pinButton.addEventListener("click", async () => {
  const pinned = await window.minovaPopout.togglePin();
  pinButton.classList.toggle("active", pinned);
  pinButton.setAttribute("aria-pressed", String(pinned));
  pinButton.title = pinned ? "Keep above other apps" : "Pin above other apps";
});

document.querySelector("#minimizeButton").addEventListener("click", () => {
  window.minovaPopout.minimize();
});

document.querySelector("#closeButton").addEventListener("click", () => {
  window.minovaPopout.close();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.minovaPopout.close();
});
