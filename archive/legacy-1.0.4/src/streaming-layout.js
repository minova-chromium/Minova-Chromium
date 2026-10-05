"use strict";

function normalizeDimension(value, minimum = 0) {
  return Math.max(minimum, Math.round(Number(value) || 0));
}

/**
 * Produces every Streaming Mode rectangle from the same inputs. Page, toolbar,
 * and toolbar capture therefore keep the same left/right edges in every UI.
 */
function calculateStreamingLayout({
  windowWidth,
  windowHeight,
  chromeHeight,
  toolbarHeight,
  sidebarWidth
}) {
  const width = normalizeDimension(windowWidth);
  const height = normalizeDimension(windowHeight);
  const sidebar = Math.min(width, normalizeDimension(sidebarWidth));
  const chrome = Math.min(height, normalizeDimension(chromeHeight));
  const toolbar = Math.min(chrome, normalizeDimension(toolbarHeight, 1));
  const contentWidth = Math.max(320, width - sidebar);
  const toolbarTop = Math.max(0, chrome - toolbar);

  return {
    page: {
      x: sidebar,
      y: chrome,
      width: contentWidth,
      height: Math.max(240, height - chrome)
    },
    toolbar: {
      x: sidebar,
      y: toolbarTop,
      width: contentWidth,
      height: toolbar
    },
    capture: {
      x: sidebar,
      y: toolbarTop,
      width: Math.max(1, width - sidebar),
      height: toolbar
    }
  };
}

module.exports = { calculateStreamingLayout };
