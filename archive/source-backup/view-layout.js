"use strict";

function clampInteger(value, minimum, maximum) {
  const number = Math.round(Number(value) || 0);
  return Math.min(maximum, Math.max(minimum, number));
}

/**
 * Calculates one native WebContentsView pane inside Minova's browser stage.
 * The final pane receives any odd remainder pixels, so the layout always
 * reaches the right edge without a blank strip.
 */
function calculateViewBounds({
  windowWidth,
  windowHeight,
  chromeHeight,
  sidebarWidth,
  rightInset = 0,
  paneIndex = 0,
  paneCount = 1,
  gap = 0,
  fullscreen = false
}) {
  const width = Math.max(0, Math.round(Number(windowWidth) || 0));
  const height = Math.max(0, Math.round(Number(windowHeight) || 0));
  if (fullscreen) return { x: 0, y: 0, width, height };

  const top = clampInteger(chromeHeight, 0, height);
  const sidebar = clampInteger(sidebarWidth, 0, Math.max(0, width - 1));
  const reservedRight = clampInteger(rightInset, 0, Math.max(0, width - sidebar));
  const panes = clampInteger(paneCount, 1, 2);
  const index = clampInteger(paneIndex, 0, panes - 1);
  const divider = clampInteger(gap, 0, width);
  const stageRight = Math.max(sidebar, width - reservedRight);
  const availableWidth = Math.max(0, stageRight - sidebar);
  const totalGap = panes > 1 ? divider * (panes - 1) : 0;
  const paneAreaWidth = Math.max(0, availableWidth - totalGap);
  const basePaneWidth = Math.floor(paneAreaWidth / panes);
  const x = sidebar + index * (basePaneWidth + divider);

  return {
    x,
    y: top,
    width: index === panes - 1 ? Math.max(0, stageRight - x) : basePaneWidth,
    height: Math.max(0, height - top)
  };
}

module.exports = { calculateViewBounds };
