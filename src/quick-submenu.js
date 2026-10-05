const title = document.querySelector("#submenuTitle");
const items = document.querySelector("#submenuItems");
const manageButton = document.querySelector("#manageButton");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
let currentType = "history";

function applyTheme(theme = {}) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode === "liquid-glass" ? "liquid-glass" : "default";
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

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function siteInitial(url) {
  return siteLabel(url).match(/[a-z0-9]/i)?.[0] || "M";
}

function formatVisitTime(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) return "";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;
  return new Date(timestamp).toLocaleDateString();
}

function render(state = {}) {
  applyTheme(state.theme);
  currentType = state.type === "bookmarks" ? "bookmarks" : "history";
  const entries = Array.isArray(state.items) ? state.items : [];
  title.textContent = currentType === "bookmarks" ? "Bookmarks" : "Recent history";
  manageButton.textContent = currentType === "bookmarks" ? "Manage bookmarks" : "Show all history";
  manageButton.dataset.action = currentType;
  clearHistoryButton.classList.toggle("hidden", currentType !== "history");
  clearHistoryButton.disabled = currentType !== "history" || !entries.length;
  items.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = currentType === "bookmarks" ? "No bookmarks saved yet." : "No browsing history yet.";
    items.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "submenu-item";
    button.setAttribute("role", "menuitem");
    const mark = document.createElement("span");
    mark.className = "site-mark";
    mark.textContent = siteInitial(entry.url);
    const copy = document.createElement("span");
    copy.className = "item-copy";
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = entry.title || siteLabel(entry.url);
    const detail = document.createElement("small");
    detail.textContent = currentType === "history"
      ? `${siteLabel(entry.url)}${entry.visitedAt ? ` · ${formatVisitTime(entry.visitedAt)}` : ""}`
      : siteLabel(entry.url);
    copy.append(itemTitle, detail);
    button.append(mark, copy);
    button.addEventListener("click", () => {
      window.minovaSubmenu.action({ action: "open-url", url: entry.url });
    });
    items.appendChild(button);
  }
}

manageButton.addEventListener("click", () => {
  window.minovaSubmenu.action(currentType);
});

clearHistoryButton.addEventListener("click", () => {
  window.minovaSubmenu.action("clear-history");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.minovaSubmenu.action("close-submenu");
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const controls = Array.from(document.querySelectorAll("button"));
  const currentIndex = controls.indexOf(document.activeElement);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = currentIndex < 0
    ? (delta > 0 ? 0 : controls.length - 1)
    : (currentIndex + delta + controls.length) % controls.length;
  controls[nextIndex]?.focus();
});

window.minovaSubmenu.onState(render);
window.minovaSubmenu.getState().then(render);
