const zoomValue = document.querySelector("#zoomValue");

function applyTheme(theme = {}) {
  const root = document.documentElement;
  const colors = theme.colors && typeof theme.colors === "object" ? theme.colors : {};
  const variables = {
    background: "--menu-background",
    panel: "--menu-surface",
    panelAlt: "--menu-hover",
    border: "--menu-border",
    text: "--menu-text",
    muted: "--menu-muted",
    accent: "--menu-accent",
    danger: "--menu-danger"
  };
  for (const [key, variable] of Object.entries(variables)) {
    const value = String(colors[key] || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) root.style.setProperty(variable, value);
  }
  root.style.setProperty("color-scheme", theme.colorScheme === "light" ? "light" : "dark");
}

function updateState(state = {}) {
  applyTheme(state.theme);
  const zoom = Math.min(1.5, Math.max(0.75, Number(state.zoom) || 1));
  zoomValue.value = `${Math.round(zoom * 100)}%`;
  zoomValue.textContent = zoomValue.value;
  document.querySelector('[data-action="zoom-out"]').disabled = zoom <= 0.75;
  document.querySelector('[data-action="zoom-in"]').disabled = zoom >= 1.5;
  document.querySelector('[data-action="reopen-closed-tab"]').disabled = !state.canReopenClosedTab;
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) await window.minovaMenu.action(action);
});

document.querySelectorAll("[data-action]").forEach((control) => {
  control.addEventListener("pointerenter", () => {
    const action = control.dataset.action;
    if (["history", "bookmarks"].includes(action)) window.minovaMenu.showSubmenu(action);
    else if (!action.startsWith("zoom-")) window.minovaMenu.closeSubmenu();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.minovaMenu.close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const controls = Array.from(document.querySelectorAll("button:not(:disabled)"));
  const currentIndex = controls.indexOf(document.activeElement);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = currentIndex < 0
    ? (delta > 0 ? 0 : controls.length - 1)
    : (currentIndex + delta + controls.length) % controls.length;
  controls[nextIndex]?.focus();
});

window.minovaMenu.onState(updateState);
window.minovaMenu.getState().then(updateState);
