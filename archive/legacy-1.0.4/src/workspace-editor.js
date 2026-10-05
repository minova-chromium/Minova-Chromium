const $ = (selector) => document.querySelector(selector);

const form = $("#workspaceForm");
const nameInput = $("#workspaceName");
const colorInput = $("#workspaceColor");
const colorValue = $("#workspaceColorValue");
const workspaceMark = $("#workspaceMark");
const status = $("#status");
const deleteButton = $("#deleteButton");
let deleteConfirmationArmed = false;

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function applyTheme(theme = {}) {
  const variables = {
    background: "--bg",
    panel: "--surface",
    panelAlt: "--surface-alt",
    border: "--border",
    text: "--text",
    muted: "--muted",
    accent: "--accent",
    danger: "--danger"
  };
  document.documentElement.style.colorScheme = theme.colorScheme === "light" ? "light" : "dark";
  for (const [key, variable] of Object.entries(variables)) {
    const value = theme.colors?.[key];
    if (validColor(value)) document.documentElement.style.setProperty(variable, value);
  }
}

function updateColorPreview() {
  const color = validColor(colorInput.value) ? colorInput.value : "#18c7be";
  colorValue.value = color.toUpperCase();
  workspaceMark.style.setProperty("--accent", color);
}

function cancel() {
  window.minovaWorkspace.cancel();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim().slice(0, 24);
  const color = colorInput.value;
  status.className = "status";
  if (!name) {
    status.textContent = "Enter a workspace name.";
    status.classList.add("error");
    nameInput.focus();
    return;
  }
  if (!validColor(color)) {
    status.textContent = "Choose a valid workspace color.";
    status.classList.add("error");
    return;
  }
  window.minovaWorkspace.finish({ action: "save", name, color });
});

deleteButton.addEventListener("click", () => {
  if (!deleteConfirmationArmed) {
    deleteConfirmationArmed = true;
    deleteButton.textContent = "Confirm delete";
    deleteButton.classList.add("confirming");
    status.textContent = "Its tabs will move to another workspace.";
    status.className = "status warning";
    return;
  }
  window.minovaWorkspace.finish({ action: "delete" });
});

colorInput.addEventListener("input", updateColorPreview);
$("#closeButton").addEventListener("click", cancel);
$("#cancelButton").addEventListener("click", cancel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancel();
});

(async () => {
  const editorState = await window.minovaWorkspace.getState();
  if (!editorState) {
    cancel();
    return;
  }

  applyTheme(editorState.theme);
  const editing = editorState.mode === "edit";
  $("#dialogTitle").textContent = editing ? "Edit workspace" : "New workspace";
  $("#dialogDescription").textContent = editing
    ? "Update how this workspace appears in Minova."
    : "Create a focused place for related tabs.";
  $("#saveButton").textContent = editing ? "Save" : "Create";
  nameInput.value = editorState.workspace?.name || "";
  colorInput.value = validColor(editorState.workspace?.color)
    ? editorState.workspace.color
    : "#18c7be";
  deleteButton.classList.toggle("hidden", !editorState.canDelete);
  updateColorPreview();
  nameInput.focus();
  nameInput.select();
})();
