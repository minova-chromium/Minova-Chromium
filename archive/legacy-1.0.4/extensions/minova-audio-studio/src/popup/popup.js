import { calculateEqHeadroom } from "../shared/dsp.js";
import { cloneValue, normalizeSettings } from "../shared/schema.js";
import {
  applyPreset,
  deletePreset,
  ensureStore,
  savePreset,
  setLiveSettings
} from "../shared/storage.js";

const $ = (selector) => document.querySelector(selector);
const compressorControls = {
  thresholdDb: {
    input: $("#thresholdInput"),
    output: $("#thresholdOutput"),
    format: (value) => `${Number(value).toFixed(0)} dB`
  },
  kneeDb: {
    input: $("#kneeInput"),
    output: $("#kneeOutput"),
    format: (value) => `${Number(value).toFixed(0)} dB`
  },
  ratio: {
    input: $("#ratioInput"),
    output: $("#ratioOutput"),
    format: (value) => `${Number(value).toFixed(1)}:1`
  },
  attackSeconds: {
    input: $("#attackInput"),
    output: $("#attackOutput"),
    format: (value) => `${Math.round(Number(value) * 1000)} ms`
  },
  releaseSeconds: {
    input: $("#releaseInput"),
    output: $("#releaseOutput"),
    format: (value) => `${Math.round(Number(value) * 1000)} ms`
  },
  makeupGainDb: {
    input: $("#makeupInput"),
    output: $("#makeupOutput"),
    format: (value) => `${Number(value).toFixed(1)} dB`
  }
};

let store;
let draft;
let editingPresetId = null;
let commitTimer = null;
let pendingCommitPreservesPreset = true;
let storageOperation = Promise.resolve();
let statusTimer = null;

function showMessage(text, error = false) {
  const message = $("#message");
  message.textContent = text;
  message.classList.toggle("error", error);
}

function formatFrequency(frequency) {
  return frequency >= 1000
    ? `${(frequency / 1000).toFixed(frequency % 1000 === 0 ? 0 : 1)}k`
    : String(Math.round(frequency));
}

function renderEqRows() {
  const container = $("#eqRows");
  container.replaceChildren();
  draft.equalizer.bands.forEach((band, index) => {
    const row = document.createElement("div");
    row.className = "eq-row";
    row.dataset.bandIndex = String(index);

    const bandLabel = document.createElement("span");
    bandLabel.textContent = String(index + 1).padStart(2, "0");

    const frequencyInput = document.createElement("input");
    frequencyInput.type = "number";
    frequencyInput.min = "20";
    frequencyInput.max = "20000";
    frequencyInput.step = "1";
    frequencyInput.value = String(band.frequencyHz);
    frequencyInput.title = `Band ${index + 1} center frequency`;
    frequencyInput.setAttribute("aria-label", `Band ${index + 1} center frequency in hertz`);
    frequencyInput.dataset.field = "frequencyHz";

    const gainControl = document.createElement("div");
    gainControl.className = "gain-control";
    const gainInput = document.createElement("input");
    gainInput.type = "range";
    gainInput.min = "-12";
    gainInput.max = "12";
    gainInput.step = "0.1";
    gainInput.value = String(band.gainDb);
    gainInput.setAttribute("aria-label", `Band ${index + 1} gain`);
    gainInput.dataset.field = "gainDb";
    const gainOutput = document.createElement("output");
    gainOutput.textContent = `${band.gainDb >= 0 ? "+" : ""}${band.gainDb.toFixed(1)} dB`;
    gainControl.append(gainInput, gainOutput);

    const qInput = document.createElement("input");
    qInput.type = "number";
    qInput.min = "0.1";
    qInput.max = "18";
    qInput.step = "0.1";
    qInput.value = String(band.q);
    qInput.title = `Band ${index + 1} Q factor`;
    qInput.setAttribute("aria-label", `Band ${index + 1} Q factor`);
    qInput.dataset.field = "q";

    row.append(bandLabel, frequencyInput, gainControl, qInput);
    container.appendChild(row);
  });
}

function renderPresetOptions() {
  const select = $("#presetSelect");
  select.replaceChildren();
  for (const preset of store.presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
  }

  if (editingPresetId && store.presets.some((preset) => preset.id === editingPresetId)) {
    select.value = editingPresetId;
  } else {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Custom";
    option.selected = true;
    select.prepend(option);
  }

  const editingPreset = store.presets.find((preset) => preset.id === editingPresetId);
  $("#presetName").value = editingPreset?.builtIn ? "" : editingPreset?.name || "";
  $("#deletePresetButton").disabled = !editingPreset || editingPreset.builtIn;
}

function renderSettings() {
  $("#enabledToggle").checked = draft.enabled;
  $("#bypassToggle").checked = draft.bypass;
  $("#compressorEnabled").checked = draft.compressor.enabled;
  $("#eqEnabled").checked = draft.equalizer.enabled;
  $("#autoHeadroomToggle").checked = draft.equalizer.autoHeadroom;
  $("#safetyMarginInput").value = String(draft.equalizer.safetyMarginDb);
  $("#outputGainInput").value = String(draft.outputGainDb);
  $("#outputGainOutput").textContent = `${draft.outputGainDb >= 0 ? "+" : ""}${draft.outputGainDb.toFixed(1)} dB`;

  for (const [field, control] of Object.entries(compressorControls)) {
    control.input.value = String(draft.compressor[field]);
    control.output.textContent = control.format(draft.compressor[field]);
  }
  renderEqRows();
  updateHeadroomReadout();
}

function updateHeadroomReadout() {
  const headroom = calculateEqHeadroom(draft.equalizer);
  $("#headroomReadout").textContent = headroom.preampDb < 0
    ? `Headroom ${headroom.preampDb.toFixed(1)} dB`
    : "Headroom 0.0 dB";
}

function markAudioConfigEdited() {
  const editingPreset = store.presets.find((preset) => preset.id === editingPresetId);
  if (!editingPreset?.builtIn) return;
  editingPresetId = null;
  renderPresetOptions();
}

function enqueueStorage(operation) {
  storageOperation = storageOperation.then(operation, operation);
  return storageOperation;
}

function commitDraft(preservePreset) {
  const snapshot = cloneValue(draft);
  return enqueueStorage(async () => {
    try {
      store = await setLiveSettings(snapshot, { preservePreset });
      showMessage("Applied to open media.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

function scheduleCommit({ preservePreset = false } = {}) {
  pendingCommitPreservesPreset = commitTimer
    ? pendingCommitPreservesPreset && preservePreset
    : preservePreset;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    const preserve = pendingCommitPreservesPreset;
    pendingCommitPreservesPreset = true;
    commitDraft(preserve);
  }, 90);
}

async function flushPendingCommit() {
  if (commitTimer) {
    clearTimeout(commitTimer);
    commitTimer = null;
    const preserve = pendingCommitPreservesPreset;
    pendingCommitPreservesPreset = true;
    await commitDraft(preserve);
    return;
  }
  await storageOperation;
}

function bindSettingsControls() {
  $("#enabledToggle").addEventListener("change", (event) => {
    draft.enabled = event.target.checked;
    scheduleCommit({ preservePreset: true });
  });
  $("#bypassToggle").addEventListener("change", (event) => {
    draft.bypass = event.target.checked;
    scheduleCommit({ preservePreset: true });
  });
  $("#compressorEnabled").addEventListener("change", (event) => {
    draft.compressor.enabled = event.target.checked;
    markAudioConfigEdited();
    scheduleCommit();
  });
  $("#eqEnabled").addEventListener("change", (event) => {
    draft.equalizer.enabled = event.target.checked;
    markAudioConfigEdited();
    updateHeadroomReadout();
    scheduleCommit();
  });
  $("#autoHeadroomToggle").addEventListener("change", (event) => {
    draft.equalizer.autoHeadroom = event.target.checked;
    markAudioConfigEdited();
    updateHeadroomReadout();
    scheduleCommit();
  });
  $("#safetyMarginInput").addEventListener("change", (event) => {
    draft.equalizer.safetyMarginDb = Number(event.target.value);
    draft = normalizeSettings(draft);
    event.target.value = String(draft.equalizer.safetyMarginDb);
    markAudioConfigEdited();
    updateHeadroomReadout();
    scheduleCommit();
  });
  $("#outputGainInput").addEventListener("input", (event) => {
    draft.outputGainDb = Number(event.target.value);
    $("#outputGainOutput").textContent = `${draft.outputGainDb >= 0 ? "+" : ""}${draft.outputGainDb.toFixed(1)} dB`;
    markAudioConfigEdited();
    scheduleCommit();
  });

  for (const [field, control] of Object.entries(compressorControls)) {
    control.input.addEventListener("input", (event) => {
      draft.compressor[field] = Number(event.target.value);
      control.output.textContent = control.format(draft.compressor[field]);
      markAudioConfigEdited();
      scheduleCommit();
    });
  }

  $("#eqRows").addEventListener("input", (event) => {
    const input = event.target.closest("input[data-field]");
    const row = input?.closest(".eq-row");
    if (!input || !row) return;
    const bandIndex = Number(row.dataset.bandIndex);
    const field = input.dataset.field;
    draft.equalizer.bands[bandIndex][field] = Number(input.value);
    draft = normalizeSettings(draft);
    if (field === "gainDb") {
      const gain = draft.equalizer.bands[bandIndex].gainDb;
      row.querySelector("output").textContent = `${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`;
    }
    if (field === "frequencyHz") input.title = formatFrequency(Number(input.value));
    markAudioConfigEdited();
    updateHeadroomReadout();
    scheduleCommit();
  });
}

function bindPresetControls() {
  $("#presetSelect").addEventListener("change", async (event) => {
    if (!event.target.value) return;
    try {
      await flushPendingCommit();
      store = await enqueueStorage(() => applyPreset(event.target.value));
      draft = cloneValue(store.settings);
      editingPresetId = store.activePresetId;
      renderPresetOptions();
      renderSettings();
      showMessage(`Loaded ${event.target.selectedOptions[0].textContent}.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#savePresetButton").addEventListener("click", async () => {
    try {
      await flushPendingCommit();
      const name = $("#presetName").value;
      const editablePreset = store.presets.find(
        (preset) => preset.id === editingPresetId && !preset.builtIn
      );
      store = await enqueueStorage(() => savePreset(
        name,
        draft,
        editablePreset?.id || null
      ));
      draft = cloneValue(store.settings);
      editingPresetId = store.activePresetId;
      renderPresetOptions();
      showMessage(`Saved ${name.trim()}.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("#deletePresetButton").addEventListener("click", async () => {
    try {
      await flushPendingCommit();
      const preset = store.presets.find((entry) => entry.id === editingPresetId);
      if (!preset || preset.builtIn) return;
      store = await enqueueStorage(() => deletePreset(preset.id));
      draft = cloneValue(store.settings);
      editingPresetId = store.activePresetId;
      renderPresetOptions();
      renderSettings();
      showMessage(`Deleted ${preset.name}.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

async function refreshRuntimeStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const status = await chrome.tabs.sendMessage(tab.id, {
      type: "MINOVA_AUDIO_GET_STATUS"
    });
    const stateLabel = status.contextState === "running"
      ? `${status.activeMediaCount} playing`
      : status.contextState === "suspended"
        ? "Idle"
        : `${status.observedMediaCount} media detected`;
    $("#runtimeStatus").textContent = stateLabel;
    $("#reductionReadout").textContent = `${Math.abs(status.compressorReductionDb || 0).toFixed(1)} dB reduction`;
    if (status.error) showMessage(status.error, true);
    else if (status.warning) showMessage(status.warning);
  } catch {
    $("#runtimeStatus").textContent = "Unavailable on this page";
  }
}

async function initialize() {
  try {
    store = await ensureStore();
    draft = cloneValue(store.settings);
    editingPresetId = store.activePresetId;
    renderPresetOptions();
    renderSettings();
    bindSettingsControls();
    bindPresetControls();
    document.addEventListener("change", () => {
      flushPendingCommit().catch((error) => showMessage(error.message, true));
    });
    await refreshRuntimeStatus();
    statusTimer = setInterval(refreshRuntimeStatus, 1000);
  } catch (error) {
    showMessage(error.message, true);
  }
}

window.addEventListener("unload", () => {
  clearInterval(statusTimer);
});

initialize();
