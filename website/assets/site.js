"use strict";

const config = window.MINOVA_SITE_CONFIG || {};
const root = document.documentElement;
const menuButton = document.querySelector("[data-menu-toggle]");
const mobileNavigation = document.querySelector("[data-mobile-navigation]");
const year = document.querySelector("[data-current-year]");

if (year) year.textContent = String(new Date().getFullYear());

document.querySelectorAll("[data-release-link]").forEach((link) => {
  link.href = config.releasePageUrl || "./releases.html";
});
document.querySelectorAll("[data-github-release-link]").forEach((link) => {
  link.href = config.releasesUrl || "https://github.com/minova-chromium/Minova-Chromium/releases/latest";
});
document.querySelectorAll("[data-repository-link]").forEach((link) => {
  link.href = config.repositoryUrl || "https://github.com/minova-chromium/Minova-Chromium";
});

if (menuButton && mobileNavigation) {
  menuButton.addEventListener("click", () => {
    const open = !mobileNavigation.classList.contains("open");
    mobileNavigation.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  });
  mobileNavigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mobileNavigation.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    });
  });
}

const observer = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12 })
  : null;

document.querySelectorAll("[data-reveal]").forEach((element) => {
  if (observer) observer.observe(element);
  else element.classList.add("visible");
});

const themeLab = document.querySelector("[data-theme-lab]");
if (themeLab) {
  const palettes = [
    {
      name: "Minova",
      background: "#111316",
      panel: "#181b20",
      raised: "#23272d",
      border: "#39414b",
      text: "#f2f5f7",
      muted: "#a0abb8",
      accent: "#18c7be",
      accentAlt: "#246fcb"
    },
    {
      name: "Aurora",
      background: "#101923",
      panel: "#172431",
      raised: "#263747",
      border: "#4b6072",
      text: "#f6fafc",
      muted: "#a7bdc8",
      accent: "#31d6aa",
      accentAlt: "#f1aa3f"
    },
    {
      name: "Crimson",
      background: "#171113",
      panel: "#25181d",
      raised: "#38242a",
      border: "#65444c",
      text: "#fff7f8",
      muted: "#c9abb0",
      accent: "#ff5c78",
      accentAlt: "#5dc9d8"
    },
    {
      name: "Daylight",
      background: "#edf3f6",
      panel: "#ffffff",
      raised: "#dce7ec",
      border: "#b8c7cf",
      text: "#15242d",
      muted: "#60747f",
      accent: "#087f78",
      accentAlt: "#275ea8"
    }
  ];
  const variableMap = {
    background: "--demo-bg",
    panel: "--demo-panel",
    raised: "--demo-raised",
    border: "--demo-border",
    text: "--demo-text",
    muted: "--demo-muted",
    accent: "--demo-accent",
    accentAlt: "--demo-accent-alt"
  };
  const controls = Array.from(themeLab.querySelectorAll("[data-demo-color]"));
  const presetButtons = Array.from(themeLab.querySelectorAll("[data-palette]"));
  const demoButton = themeLab.querySelector("[data-theme-demo]");
  const demoLabel = themeLab.querySelector("[data-theme-name]");
  let demoTimer = null;
  let paletteIndex = 0;

  function applyPalette(palette, updateInputs = true) {
    for (const [key, variable] of Object.entries(variableMap)) {
      themeLab.style.setProperty(variable, palette[key]);
    }
    if (updateInputs) {
      for (const control of controls) control.value = palette[control.dataset.demoColor];
    }
    if (demoLabel) demoLabel.textContent = palette.name;
    presetButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.palette === palette.name));
    });
  }

  function stopDemo() {
    window.clearInterval(demoTimer);
    demoTimer = null;
    demoButton?.classList.remove("playing");
    demoButton?.setAttribute("aria-pressed", "false");
    const label = demoButton?.querySelector("span");
    if (label) label.textContent = "Play color demo";
  }

  function startDemo() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    stopDemo();
    demoButton?.classList.add("playing");
    demoButton?.setAttribute("aria-pressed", "true");
    const label = demoButton?.querySelector("span");
    if (label) label.textContent = "Pause color demo";
    demoTimer = window.setInterval(() => {
      paletteIndex = (paletteIndex + 1) % palettes.length;
      applyPalette(palettes[paletteIndex]);
    }, 1500);
  }

  controls.forEach((control) => {
    control.addEventListener("input", () => {
      stopDemo();
      themeLab.style.setProperty(variableMap[control.dataset.demoColor], control.value);
      if (demoLabel) demoLabel.textContent = "Your palette";
      presetButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    });
  });

  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      stopDemo();
      paletteIndex = Math.max(0, palettes.findIndex((palette) => palette.name === button.dataset.palette));
      applyPalette(palettes[paletteIndex]);
    });
  });

  demoButton?.addEventListener("click", () => {
    if (demoTimer) stopDemo();
    else startDemo();
  });

  applyPalette(palettes[0]);
  const labObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          window.setTimeout(startDemo, 700);
          labObserver.disconnect();
        }
      }, { threshold: 0.45 })
    : null;
  if (labObserver) labObserver.observe(themeLab);
}

root.classList.add("js-ready");
