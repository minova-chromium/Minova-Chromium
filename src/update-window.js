"use strict";

const readyView = document.querySelector("#readyView");
const installingView = document.querySelector("#installingView");
const versionText = document.querySelector("#versionText");
const releaseNotes = document.querySelector("#releaseNotes");

function normalizeNotes(value) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[\s*#\-•]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function renderDetails(details = {}) {
  versionText.textContent = String(details.version || "");
  const notes = normalizeNotes(details.releaseNotes);
  releaseNotes.replaceChildren(...(notes.length ? notes : ["General stability and performance improvements."]).map((note) => {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    const text = document.createTextNode(note);
    item.append(marker, text);
    return item;
  }));
}

function showInstalling() {
  readyView.classList.add("hidden");
  installingView.classList.remove("hidden");
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "update") showInstalling();
    window.minovaUpdate.choose(action);
  });
});

window.minovaUpdate.onDetails(renderDetails);
window.minovaUpdate.onInstalling(showInstalling);
