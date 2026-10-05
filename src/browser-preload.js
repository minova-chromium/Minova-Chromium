const { ipcRenderer } = require("electron");

if (window.top === window) {
  const LOGIN_HINT = /(user|email|e-mail|login|account|identifier)/i;
  const state = {
    field: null,
    credentials: [],
    host: null,
    shadow: null,
    panel: null,
    requestToken: 0,
    autofillComplete: false,
    autofillRunning: false
  };

  function isVisible(input) {
    const bounds = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return bounds.width > 0
      && bounds.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none";
  }

  function isLoginField(input) {
    if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly || !isVisible(input)) return false;
    const type = String(input.type || "text").toLowerCase();
    const autocomplete = String(input.autocomplete || "").toLowerCase();
    if (autocomplete.includes("new-password")) return false;
    if (type === "password" || type === "email") return true;
    if (!["text", "tel"].includes(type)) return false;
    if (LOGIN_HINT.test(`${input.name} ${input.id} ${autocomplete} ${input.placeholder}`)) return true;
    return Boolean(input.form?.querySelector('input[type="password"]'));
  }

  function setInputValue(input, value) {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function relatedInputs(field) {
    const scope = field.form || field.closest("form") || document;
    const inputs = Array.from(scope.querySelectorAll("input")).filter((input) => (
      !input.disabled && !input.readOnly && isVisible(input)
    ));
    const password = inputs.find((input) => (
      input.type === "password" && !String(input.autocomplete || "").toLowerCase().includes("new-password")
    ));
    const username = inputs.find((input) => {
      const type = String(input.type || "text").toLowerCase();
      const hint = `${input.name} ${input.id} ${input.autocomplete} ${input.placeholder}`;
      return input !== password && (type === "email" || (["text", "tel"].includes(type) && LOGIN_HINT.test(hint)));
    }) || (field.type !== "password" ? field : null);
    return { username, password };
  }

  function hide() {
    state.field = null;
    state.credentials = [];
    if (state.host) state.host.hidden = true;
    if (state.panel) state.panel.replaceChildren();
  }

  function position() {
    if (!state.field || !state.host || state.host.hidden) return;
    const bounds = state.field.getBoundingClientRect();
    const availableBelow = window.innerHeight - bounds.bottom;
    const height = Math.min(280, 58 + state.credentials.length * 54);
    const top = availableBelow >= height || bounds.top < height
      ? bounds.bottom + 6
      : Math.max(8, bounds.top - height - 6);
    const width = Math.max(280, Math.min(420, bounds.width));
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
    state.host.style.setProperty("--minova-left", `${left}px`);
    state.host.style.setProperty("--minova-top", `${top}px`);
    state.host.style.setProperty("--minova-width", `${width}px`);
  }

  async function choose(credentialId) {
    const field = state.field;
    if (!field || !document.contains(field)) return hide();
    try {
      const credential = await ipcRenderer.invoke("credentials:resolve", credentialId);
      if (!credential) return hide();
      const inputs = relatedInputs(field);
      setInputValue(inputs.username, credential.username);
      setInputValue(inputs.password, credential.password);
      if (field.type === "password" && !inputs.password) setInputValue(field, credential.password);
      hide();
    } catch {
      hide();
    }
  }

  function render() {
    if (!state.panel) return;
    state.panel.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "heading";
    heading.textContent = "Passwords saved in Minova";
    state.panel.appendChild(heading);

    for (const credential of state.credentials) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "credential";
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        choose(credential.id);
      });

      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = String(credential.username || "?").trim().charAt(0).toUpperCase() || "?";
      const copy = document.createElement("span");
      copy.className = "copy";
      const username = document.createElement("strong");
      username.textContent = credential.username;
      const detail = document.createElement("small");
      detail.textContent = `${credential.site} - password`;
      copy.append(username, detail);
      button.append(avatar, copy);
      state.panel.appendChild(button);
    }
    state.host.hidden = false;
    position();
  }

  async function showFor(field) {
    if (!isLoginField(field)) return hide();
    const token = ++state.requestToken;
    state.field = field;
    try {
      const credentials = await ipcRenderer.invoke("credentials:metadata");
      if (token !== state.requestToken || state.field !== field) return;
      state.credentials = Array.isArray(credentials) ? credentials : [];
      if (!state.credentials.length) return hide();
      render();
    } catch {
      hide();
    }
  }

  async function autofillUniqueCredential() {
    if (state.autofillComplete || state.autofillRunning) return false;
    const passwordField = Array.from(document.querySelectorAll('input[type="password"]'))
      .find((input) => (
        !input.disabled
        && !input.readOnly
        && !input.value
        && isVisible(input)
        && !String(input.autocomplete || "").toLowerCase().includes("new-password")
      ));
    if (!passwordField) return false;
    state.autofillRunning = true;
    try {
      const credential = await ipcRenderer.invoke("credentials:autofill");
      if (!credential) return false;
      const inputs = relatedInputs(passwordField);
      if (inputs.username && !inputs.username.value) setInputValue(inputs.username, credential.username);
      if (inputs.password && !inputs.password.value) setInputValue(inputs.password, credential.password);
      state.autofillComplete = true;
      return true;
    } catch {
      return false;
    } finally {
      state.autofillRunning = false;
    }
  }

  function markUnsavedChanges(event) {
    if (!event.isTrusted) return;
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
    if (!control.form && !control.closest("form")) return;
    document.documentElement.dataset.minovaUnsavedChanges = "true";
  }

  function clearUnsavedChanges() {
    if (document.documentElement) document.documentElement.dataset.minovaUnsavedChanges = "false";
  }

  function mount() {
    if (state.host || !document.documentElement) return;
    const host = document.createElement("div");
    host.hidden = true;
    host.setAttribute("aria-label", "Minova password suggestions");
    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.className = "panel";
    const css = `
      :host { all: initial; position: fixed; left: var(--minova-left); top: var(--minova-top); width: var(--minova-width); z-index: 2147483647; color-scheme: dark; }
      :host([hidden]) { display: none !important; }
      .panel { overflow: hidden; max-height: 280px; overflow-y: auto; border: 1px solid #354154; border-radius: 8px; background: #171d29; color: #edf4ff; box-shadow: 0 16px 45px rgba(0,0,0,.48); font: 13px "Segoe UI", system-ui, sans-serif; }
      .heading { padding: 10px 12px 8px; color: #9aa8bd; font-size: 11px; font-weight: 600; }
      .credential { width: 100%; min-height: 54px; display: grid; grid-template-columns: 34px minmax(0,1fr); align-items: center; gap: 10px; padding: 7px 11px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .credential:hover, .credential:focus-visible { background: #1f2735; outline: 0; }
      .avatar { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: #18c7be; color: #071513; font-weight: 750; }
      .copy { min-width: 0; display: grid; gap: 2px; }
      strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      strong { font-size: 13px; font-weight: 600; }
      small { color: #9aa8bd; font-size: 11px; }
    `;
    if ("adoptedStyleSheets" in shadow && "replaceSync" in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    }
    shadow.appendChild(panel);
    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
    state.panel = panel;
  }

  window.addEventListener("DOMContentLoaded", mount, { once: true });
  if (document.documentElement) mount();
  document.addEventListener("input", markUnsavedChanges, true);
  document.addEventListener("change", markUnsavedChanges, true);
  document.addEventListener("submit", clearUnsavedChanges, true);
  window.addEventListener("pagehide", clearUnsavedChanges);
  document.addEventListener("focusin", (event) => {
    if (event.composedPath().includes(state.host)) return;
    showFor(event.target);
  }, true);
  document.addEventListener("mousedown", (event) => {
    const path = event.composedPath();
    if (event.target !== state.field && !path.includes(state.host)) hide();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  }, true);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);

  window.addEventListener("DOMContentLoaded", () => {
    let autofillTimer = null;
    const scheduleAutofill = () => {
      clearTimeout(autofillTimer);
      autofillTimer = setTimeout(() => {
        autofillUniqueCredential().then((completed) => {
          if (completed) observer.disconnect();
        });
      }, 280);
    };
    const observer = new MutationObserver(scheduleAutofill);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    scheduleAutofill();
    setTimeout(() => observer.disconnect(), 30000);
  }, { once: true });

  const STREAMING_FAILURE_PATTERN = /(?:M7\d{3}(?:-\d+)?|widevine|digital rights management|protected content|playback (?:error|failed)|video (?:error|failed)|cannot play (?:this|the) (?:title|video)|can't play (?:this|the) (?:title|video)|browser (?:is not|isn't) supported|not supported in (?:this|your) browser)/i;
  let streamingFailureTimer = null;
  let lastStreamingFailure = "";

  function reportStreamingFailure(detail) {
    const message = String(detail || "Playback error").slice(0, 160);
    const signature = `${location.href}:${message}`;
    if (signature === lastStreamingFailure) return;
    lastStreamingFailure = signature;
    ipcRenderer.send("browser:streaming-playback-error", { url: location.href, detail: message });
  }

  function scanForStreamingFailure() {
    clearTimeout(streamingFailureTimer);
    streamingFailureTimer = setTimeout(() => {
      const match = String(document.body?.innerText || "").slice(0, 250000).match(STREAMING_FAILURE_PATTERN);
      if (match) reportStreamingFailure(match[0]);
    }, 500);
  }

  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLMediaElement) {
      reportStreamingFailure(event.target.error?.message || `Media error ${event.target.error?.code || "unknown"}`);
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    const detail = event.reason?.message || String(event.reason || "");
    if (STREAMING_FAILURE_PATTERN.test(detail)) reportStreamingFailure(detail);
  });
  window.addEventListener("DOMContentLoaded", () => {
    scanForStreamingFailure();
    if (document.body) new MutationObserver(scanForStreamingFailure).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, { once: true });
}
