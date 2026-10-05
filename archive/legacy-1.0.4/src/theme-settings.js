"use strict";

const DEFAULT_CUSTOM_THEME_COLORS = Object.freeze({
  background: "#111316",
  panel: "#181b20",
  panelAlt: "#23272d",
  border: "#39414b",
  text: "#f2f5f7",
  muted: "#a0abb8",
  accent: "#18c7be",
  accentAlt: "#246fcb",
  danger: "#ff6b6b"
});

function normalizeHexColor(value, fallback) {
  const color = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split("").map((character) => character.repeat(2)).join("")}`;
  }
  return fallback;
}

function normalizeCustomThemeColors(value, fallback = DEFAULT_CUSTOM_THEME_COLORS) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_CUSTOM_THEME_COLORS).map(([key, defaultColor]) => [
      key,
      normalizeHexColor(input[key], normalizeHexColor(fallback?.[key], defaultColor))
    ])
  );
}

module.exports = {
  DEFAULT_CUSTOM_THEME_COLORS,
  normalizeCustomThemeColors,
  normalizeHexColor
};
