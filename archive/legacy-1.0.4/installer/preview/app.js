"use strict";

const query = new URLSearchParams(window.location.search);
const requestedScreen = query.get("screen") || "installer";
const installerView = document.querySelector("#installerView");
const updateView = document.querySelector("#updateView");
const setupStep = document.querySelector("#setupStep");
const progressStep = document.querySelector("#progressStep");
const completeStep = document.querySelector("#completeStep");
const installButton = document.querySelector("#installButton");
const cancelButton = document.querySelector("#cancelButton");
const windowTitle = document.querySelector("#windowTitle");
const progressFill = document.querySelector("#progressFill");
const progressStatus = document.querySelector("#progressStatus");
const progressPercent = document.querySelector("#progressPercent");
const progressTrack = document.querySelector(".progress-track");
let progressTimer = null;

function setInstallerState(nextState, percentage = 0) {
  setupStep.classList.toggle("hidden", nextState !== "installer");
  progressStep.classList.toggle("hidden", nextState !== "progress");
  completeStep.classList.toggle("hidden", nextState !== "complete");

  if (nextState === "progress") {
    cancelButton.textContent = "Minimize";
    installButton.classList.add("hidden");
    applyProgress(percentage);
    return;
  }

  installButton.classList.remove("hidden");
  if (nextState === "complete") {
    cancelButton.classList.add("hidden");
    installButton.querySelector("span").textContent = "Open Minova";
    return;
  }

  cancelButton.classList.remove("hidden");
  installButton.querySelector("span").textContent = "Install Minova";
}

function applyProgress(percentage) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percentage)));
  const stages = [
    { minimum: 0, name: "prepare", label: "Preparing browser files" },
    { minimum: 18, name: "install", label: "Installing Minova" },
    { minimum: 73, name: "shortcuts", label: "Creating Windows shortcuts" },
    { minimum: 90, name: "finish", label: "Running final checks" }
  ];
  const activeStage = [...stages].reverse().find((stage) => safePercent >= stage.minimum) || stages[0];

  progressFill.style.width = `${safePercent}%`;
  progressPercent.textContent = `${safePercent}%`;
  progressStatus.textContent = activeStage.label;
  progressTrack.setAttribute("aria-valuenow", String(safePercent));

  document.querySelectorAll(".install-stages li").forEach((item) => {
    const stageIndex = stages.findIndex((stage) => stage.name === item.dataset.stage);
    const activeIndex = stages.findIndex((stage) => stage.name === activeStage.name);
    item.classList.toggle("active", stageIndex === activeIndex);
    item.classList.toggle("done", stageIndex < activeIndex);
  });
}

function startProgress() {
  setInstallerState("progress", 0);
  let percentage = 0;
  progressTimer = window.setInterval(() => {
    percentage = Math.min(100, percentage + Math.max(1, Math.round((105 - percentage) / 13)));
    applyProgress(percentage);
    if (percentage < 100) return;
    window.clearInterval(progressTimer);
    window.setTimeout(() => setInstallerState("complete"), 380);
  }, 180);
}

if (requestedScreen === "update") {
  installerView.classList.add("hidden");
  updateView.classList.remove("hidden");
  windowTitle.textContent = "Minova Update";
} else if (requestedScreen === "progress") {
  setInstallerState("progress", 68);
} else if (requestedScreen === "complete") {
  setInstallerState("complete");
}

installButton.addEventListener("click", () => {
  if (!completeStep.classList.contains("hidden")) return;
  startProgress();
});

document.querySelector(".browse-button").addEventListener("click", () => {
  document.querySelector("#installPath").focus();
  document.querySelector("#installPath").select();
});
