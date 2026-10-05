const $ = (selector) => document.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));

const compressorControls = {
  thresholdDb: { input: $("#thresholdInput"), output: $("#thresholdOutput"), format: (value) => `${Number(value).toFixed(0)} dB` },
  kneeDb: { input: $("#kneeInput"), output: $("#kneeOutput"), format: (value) => `${Number(value).toFixed(0)} dB` },
  ratio: { input: $("#ratioInput"), output: $("#ratioOutput"), format: (value) => `${Number(value).toFixed(1)}:1` },
  attackSeconds: { input: $("#attackInput"), output: $("#attackOutput"), format: (value) => `${Math.round(Number(value) * 1000)} ms` },
  releaseSeconds: { input: $("#releaseInput"), output: $("#releaseOutput"), format: (value) => `${Math.round(Number(value) * 1000)} ms` },
  makeupGainDb: { input: $("#makeupInput"), output: $("#makeupOutput"), format: (value) => `${Number(value).toFixed(1)} dB` }
};

let panelState = null;
let store = null;
let draft = null;
let editingPresetId = null;
let commitTimer = null;
let actionQueue = Promise.resolve();
let localEditUntil = 0;

function formatFrequency(value) {
  const frequency = Number(value);
  return frequency >= 1000
    ? `${(frequency / 1000).toFixed(frequency % 1000 === 0 ? 0 : 1)}k`
    : String(Math.round(frequency));
}

function showMessage(message, type = "") {
  $("#volumeStatus").textContent = message || "Audio Studio is ready.";
  document.body.classList.toggle("warning", type === "warning");
  document.body.classList.toggle("error", type === "error");
}

function renderRuntime() {
  if (!panelState) return;
  const runtime = panelState.audioRuntime || {};
  const observed = Number(runtime.observedMediaCount) || 0;
  const active = Number(runtime.activeMediaCount) || 0;
  const contextState = runtime.contextState || "idle";
  $("#runtimeStatus").textContent = panelState.streamingMode
    ? "Unavailable while Streaming Mode is in front"
    : runtime.error
      ? "Processor unavailable on this player"
      : active
        ? `${active} media ${active === 1 ? "source" : "sources"} playing`
        : observed
          ? contextState === "suspended" ? "Idle - processor suspended" : `${observed} media detected`
          : "No media detected in this tab";
  $("#reductionReadout").textContent = `${Math.abs(Number(runtime.compressorReductionDb) || 0).toFixed(1)} dB reduction`;
  if (runtime.error) showMessage(runtime.error, "error");
  else if (runtime.warning) showMessage(runtime.warning, "warning");
  else if (panelState.message) showMessage(panelState.message);
  else showMessage(panelState.hasMedia ? "Processing follows playback automatically." : "Open media in this tab to begin.");
}

function renderMaster() {
  const percent = Math.round((Number(panelState?.boost) || 1) * 100);
  $("#boostSlider").value = String(percent);
  $("#boostSlider").disabled = Boolean(panelState?.protectedMedia || panelState?.streamingMode);
  $("#boostValue").value = `${percent}%`;
  $("#boostValue").textContent = `${percent}%`;
  $("#muteButton").textContent = panelState?.muted ? "Unmute" : "Mute";
  $("#muteButton").disabled = !panelState?.tabId || panelState?.streamingMode;
}

function renderPresetOptions() {
  const select = $("#presetSelect");
  select.replaceChildren();
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom";
  select.appendChild(custom);
  for (const preset of store.presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
  }
  select.value = store.presets.some((preset) => preset.id === editingPresetId) ? editingPresetId : "";
  const editingPreset = store.presets.find((preset) => preset.id === editingPresetId);
  $("#presetName").value = editingPreset?.builtIn ? "" : editingPreset?.name || "";
  $("#deletePresetButton").disabled = !editingPreset || editingPreset.builtIn;
}

function renderEqRows() {
  const rows = $("#eqRows");
  rows.replaceChildren();
  draft.equalizer.bands.forEach((band, index) => {
    const row = document.createElement("div");
    row.className = "eq-row";
    row.dataset.bandIndex = String(index);

    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");

    const frequency = document.createElement("input");
    frequency.type = "number";
    frequency.min = "20";
    frequency.max = "20000";
    frequency.step = "1";
    frequency.value = String(band.frequencyHz);
    frequency.dataset.field = "frequencyHz";
    frequency.title = `${formatFrequency(band.frequencyHz)} center frequency`;
    frequency.setAttribute("aria-label", `Band ${index + 1} center frequency`);

    const gainControl = document.createElement("div");
    gainControl.className = "gain-control";
    const gain = document.createElement("input");
    gain.type = "range";
    gain.min = "-12";
    gain.max = "12";
    gain.step = "0.1";
    gain.value = String(band.gainDb);
    gain.dataset.field = "gainDb";
    gain.setAttribute("aria-label", `Band ${index + 1} gain`);
    const gainValue = document.createElement("output");
    gainValue.textContent = `${band.gainDb >= 0 ? "+" : ""}${Number(band.gainDb).toFixed(1)} dB`;
    gainControl.append(gain, gainValue);

    const q = document.createElement("input");
    q.type = "number";
    q.min = "0.1";
    q.max = "18";
    q.step = "0.1";
    q.value = String(band.q);
    q.dataset.field = "q";
    q.setAttribute("aria-label", `Band ${index + 1} Q factor`);
    row.append(number, frequency, gainControl, q);
    rows.appendChild(row);
  });
}

function renderSettings() {
  $("#enabledToggle").checked = draft.enabled;
  $("#bypassToggle").checked = draft.bypass;
  $("#compressorEnabled").checked = draft.compressor.enabled;
  $("#eqEnabled").checked = draft.equalizer.enabled;
  $("#autoHeadroomToggle").checked = draft.equalizer.autoHeadroom;
  $("#safetyMarginInput").value = String(draft.equalizer.safetyMarginDb);
  $("#outputGainInput").value = String(draft.outputGainDb);
  $("#outputGainOutput").textContent = `${draft.outputGainDb >= 0 ? "+" : ""}${Number(draft.outputGainDb).toFixed(1)} dB`;
  for (const [field, control] of Object.entries(compressorControls)) {
    control.input.value = String(draft.compressor[field]);
    control.output.textContent = control.format(draft.compressor[field]);
  }
  renderEqRows();
  const headroom = Number(panelState?.headroom?.preampDb) || 0;
  $("#headroomReadout").textContent = `Headroom ${headroom.toFixed(1)} dB`;
}

function adoptState(nextState, force = false) {
  if (!nextState) return;
  panelState = nextState;
  store = nextState.audioStudio || store;
  const editingLocally = Date.now() < localEditUntil;
  if (store && (!draft || force || !editingLocally)) {
    draft = clone(store.settings);
    editingPresetId = store.activePresetId;
    renderPresetOptions();
    renderSettings();
  }
  renderMaster();
  renderRuntime();
}

function enqueueAction(payload, { force = false } = {}) {
  actionQueue = actionQueue.then(async () => {
    const next = await window.minovaVolume.action(payload);
    adoptState(next, force);
    return next;
  }, async () => {
    const next = await window.minovaVolume.action(payload);
    adoptState(next, force);
    return next;
  }).catch((error) => {
    showMessage(error.message || String(error), "error");
  });
  return actionQueue;
}

function markEdited() {
  localEditUntil = Date.now() + 800;
  const preset = store.presets.find((entry) => entry.id === editingPresetId);
  if (preset?.builtIn) {
    editingPresetId = null;
    renderPresetOptions();
  }
}

function scheduleSettingsCommit({ preservePreset = false } = {}) {
  markEdited();
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    enqueueAction({ action: "update-settings", settings: clone(draft), preservePreset });
  }, 80);
}

function bindSettings() {
  $("#enabledToggle").addEventListener("change", (event) => {
    draft.enabled = event.target.checked;
    scheduleSettingsCommit({ preservePreset: true });
  });
  $("#bypassToggle").addEventListener("change", (event) => {
    draft.bypass = event.target.checked;
    scheduleSettingsCommit({ preservePreset: true });
  });
  $("#compressorEnabled").addEventListener("change", (event) => {
    draft.compressor.enabled = event.target.checked;
    scheduleSettingsCommit();
  });
  $("#eqEnabled").addEventListener("change", (event) => {
    draft.equalizer.enabled = event.target.checked;
    scheduleSettingsCommit();
  });
  $("#autoHeadroomToggle").addEventListener("change", (event) => {
    draft.equalizer.autoHeadroom = event.target.checked;
    scheduleSettingsCommit();
  });
  $("#safetyMarginInput").addEventListener("change", (event) => {
    draft.equalizer.safetyMarginDb = Number(event.target.value);
    scheduleSettingsCommit();
  });
  $("#outputGainInput").addEventListener("input", (event) => {
    draft.outputGainDb = Number(event.target.value);
    $("#outputGainOutput").textContent = `${draft.outputGainDb >= 0 ? "+" : ""}${draft.outputGainDb.toFixed(1)} dB`;
    scheduleSettingsCommit();
  });
  for (const [field, control] of Object.entries(compressorControls)) {
    control.input.addEventListener("input", (event) => {
      draft.compressor[field] = Number(event.target.value);
      control.output.textContent = control.format(draft.compressor[field]);
      scheduleSettingsCommit();
    });
  }
  $("#eqRows").addEventListener("input", (event) => {
    const input = event.target.closest('input[data-field="gainDb"]');
    if (!input) return;
    const row = input.closest(".eq-row");
    const band = draft.equalizer.bands[Number(row.dataset.bandIndex)];
    band.gainDb = Number(input.value);
    row.querySelector("output").textContent = `${band.gainDb >= 0 ? "+" : ""}${band.gainDb.toFixed(1)} dB`;
    scheduleSettingsCommit();
  });
  $("#eqRows").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-field]");
    if (!input || input.dataset.field === "gainDb") return;
    const row = input.closest(".eq-row");
    draft.equalizer.bands[Number(row.dataset.bandIndex)][input.dataset.field] = Number(input.value);
    scheduleSettingsCommit();
  });
}

function bindPresets() {
  $("#presetSelect").addEventListener("change", (event) => {
    if (!event.target.value) return;
    clearTimeout(commitTimer);
    commitTimer = null;
    enqueueAction({ action: "apply-preset", presetId: event.target.value }, { force: true });
  });
  $("#savePresetButton").addEventListener("click", () => {
    const editable = store.presets.find((preset) => preset.id === editingPresetId && !preset.builtIn);
    enqueueAction({
      action: "save-preset",
      name: $("#presetName").value,
      settings: clone(draft),
      presetId: editable?.id || null
    }, { force: true });
  });
  $("#deletePresetButton").addEventListener("click", () => {
    if (!editingPresetId) return;
    enqueueAction({ action: "delete-preset", presetId: editingPresetId }, { force: true });
  });
}

$("#boostSlider").addEventListener("input", (event) => {
  const percent = Number(event.target.value);
  $("#boostValue").value = `${percent}%`;
  $("#boostValue").textContent = `${percent}%`;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => enqueueAction({ action: "set-boost", value: percent / 100 }), 55);
});
$("#muteButton").addEventListener("click", () => enqueueAction({ action: "toggle-mute" }));
$("#resetButton").addEventListener("click", () => enqueueAction({ action: "reset" }, { force: true }));
$("#closeButton").addEventListener("click", () => window.minovaVolume.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.minovaVolume.close();
});

window.minovaVolume.onState((nextState) => adoptState(nextState));

async function initialize() {
  const initial = await window.minovaVolume.getState();
  adoptState(initial, true);
  bindSettings();
  bindPresets();
  setInterval(async () => {
    try {
      adoptState(await window.minovaVolume.getState());
    } catch {}
  }, 1000);
}

initialize().catch((error) => showMessage(error.message || String(error), "error"));
