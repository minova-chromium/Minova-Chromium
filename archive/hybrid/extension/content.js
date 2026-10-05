(() => {
  if (window.top !== window || document.documentElement.dataset.minovaHybridUi === "active") return;
  document.documentElement.dataset.minovaHybridUi = "active";

  const UI_HEIGHT = 88;
  const host = document.createElement("div");
  host.id = "minova-hybrid-ui";
  host.style.cssText = `all:initial;position:fixed;inset:0 0 auto 0;height:${UI_HEIGHT}px;z-index:2147483647;display:block;`;
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; letter-spacing: 0; }
      button, input { font: inherit; }
      .shell { height: 88px; color: #f5f8fc; background: #0c1119; border-bottom: 1px solid #2c3747; font: 12px "Segoe UI", Arial, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.32); }
      .titlebar { height: 36px; display: flex; align-items: end; padding-left: 8px; background: #0a0f17; }
      .tabs { min-width: 0; max-width: calc(100vw - 202px); height: 34px; display: flex; align-items: end; gap: 2px; overflow: hidden; }
      .tab { min-width: 96px; max-width: 214px; flex: 1 1 180px; height: 32px; display: grid; grid-template-columns: 18px minmax(0,1fr) 22px; align-items: center; gap: 7px; padding: 0 7px 0 10px; border: 1px solid transparent; border-bottom: 0; border-radius: 7px 7px 0 0; color: #b9c8dc; background: #111823; cursor: default; }
      .tab.active { color: #fff; background: #171f2c; border-color: #354257; }
      .tab img, .tab .fallback { width: 16px; height: 16px; border-radius: 3px; object-fit: contain; }
      .tab .fallback { display: grid; place-items: center; color: #fff; background: #087e9a; font-size: 10px; font-weight: 700; }
      .tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tab-close, .new-tab, .icon, .window-control { border: 0; color: inherit; background: transparent; cursor: default; }
      .tab-close { width: 22px; height: 22px; border-radius: 4px; }
      .tab-close:hover, .new-tab:hover, .icon:hover { background: rgba(255,255,255,.1); }
      .new-tab { flex: 0 0 34px; height: 32px; margin-bottom: 1px; border-radius: 6px; font-size: 19px; }
      .drag { flex: 1; height: 100%; }
      .window-controls { height: 36px; display: flex; align-self: stretch; }
      .window-control { width: 46px; position: relative; }
      .window-control:hover { background: rgba(255,255,255,.1); }
      .window-control.close:hover { background: #d93025; }
      .window-control span, .window-control span::before, .window-control span::after { content: ""; position: absolute; display: block; }
      .window-control.minimize span { width: 11px; height: 1px; left: 18px; top: 18px; background: currentColor; }
      .window-control.maximize span { width: 11px; height: 11px; left: 17px; top: 12px; border: 1px solid currentColor; }
      .window-control.close span::before, .window-control.close span::after { width: 14px; height: 1px; left: 16px; top: 17px; background: currentColor; }
      .window-control.close span::before { transform: rotate(45deg); }
      .window-control.close span::after { transform: rotate(-45deg); }
      .toolbar { height: 52px; display: grid; grid-template-columns: repeat(4,34px) minmax(220px,1fr) repeat(3,34px); align-items: center; gap: 7px; padding: 7px 8px; background: #151d2a; }
      .icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 6px; font-size: 17px; }
      .omnibox { position: relative; min-width: 0; }
      .address { width: 100%; height: 36px; padding: 0 42px 0 76px; border: 1px solid #354257; border-radius: 18px; outline: 0; color: #f8fbff; background: #0e1520; }
      .address:focus { border-color: #18b8c8; box-shadow: 0 0 0 1px #18b8c8; }
      .brand { position: absolute; z-index: 1; left: 12px; top: 10px; display: flex; align-items: center; gap: 6px; color: #7fdbe0; font-size: 11px; pointer-events: none; }
      .brand img { width: 17px; height: 17px; border-radius: 4px; }
      .suggestions { position: absolute; left: 0; right: 0; top: 42px; max-height: 330px; overflow: auto; padding: 6px; border: 1px solid #354257; border-radius: 7px; background: #171f2c; box-shadow: 0 16px 38px rgba(0,0,0,.46); }
      .suggestions.hidden, .menu.hidden { display: none; }
      .suggestion { width: 100%; display: grid; gap: 2px; padding: 8px 10px; border: 0; border-radius: 5px; color: #f4f7fb; background: transparent; text-align: left; }
      .suggestion:hover { background: #273345; }
      .suggestion strong, .suggestion span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .suggestion span { color: #91a8c4; font-size: 11px; }
      .bookmark.active { color: #53d6c8; }
      .menu-wrap { position: relative; }
      .menu { position: absolute; z-index: 3; right: 0; top: 40px; width: 260px; padding: 7px; border: 1px solid #3a4658; border-radius: 7px; background: #202733; box-shadow: 0 18px 46px rgba(0,0,0,.48); }
      .menu button { width: 100%; min-height: 34px; display: flex; align-items: center; padding: 0 10px; border: 0; border-radius: 5px; color: #f4f7fb; background: transparent; text-align: left; }
      .menu button:hover { background: #343f50; }
      .separator { height: 1px; margin: 6px 0; background: #3b4656; }
      .status { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 9px 13px; border-radius: 6px; color: #fff; background: #263244; box-shadow: 0 10px 28px rgba(0,0,0,.4); opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
      .status.visible { opacity: 1; }
    </style>
    <div class="shell">
      <div class="titlebar">
        <div class="tabs" id="tabs"></div>
        <button class="new-tab" id="newTab" title="New tab" aria-label="New tab">+</button>
        <div class="drag"></div>
        <div class="window-controls">
          <button class="window-control minimize" data-window="window-minimize" title="Minimize" aria-label="Minimize"><span></span></button>
          <button class="window-control maximize" data-window="window-maximize" title="Maximize" aria-label="Maximize"><span></span></button>
          <button class="window-control close" data-window="window-close" title="Close" aria-label="Close"><span></span></button>
        </div>
      </div>
      <div class="toolbar">
        <button class="icon" data-action="back" title="Back" aria-label="Back">&#x2039;</button>
        <button class="icon" data-action="forward" title="Forward" aria-label="Forward">&#x203A;</button>
        <button class="icon" data-action="reload" title="Reload" aria-label="Reload">&#x21BB;</button>
        <button class="icon" data-action="home" title="Home" aria-label="Home">&#x2302;</button>
        <form class="omnibox" id="navigation">
          <span class="brand"><img src="${chrome.runtime.getURL("icons/minova.png")}" alt="" />Minova</span>
          <input class="address" id="address" autocomplete="off" spellcheck="false" aria-label="Address and search bar" />
          <div class="suggestions hidden" id="suggestions"></div>
        </form>
        <button class="icon bookmark" id="bookmark" title="Bookmark" aria-label="Bookmark">&#x2606;</button>
        <button class="icon" id="extensions" title="Extensions" aria-label="Extensions">&#x2699;</button>
        <div class="menu-wrap">
          <button class="icon" id="menuButton" title="Minova menu" aria-label="Minova menu">&#x22EE;</button>
          <div class="menu hidden" id="menu">
            <button data-command="new-tab">New tab</button>
            <button data-command="new-window">New window</button>
            <button data-command="new-private-window">New private window</button>
            <div class="separator"></div>
            <button data-command="history">History</button>
            <button data-command="downloads">Downloads</button>
            <button data-command="extensions">Extensions</button>
            <div class="separator"></div>
            <button data-command="fullscreen">Full screen</button>
            <button data-command="settings">Edge settings</button>
            <button data-command="close-window">Exit</button>
          </div>
        </div>
      </div>
    </div>
    <div class="status" id="status"></div>
  `;

  let state = { tabs: [], activeTabId: null, bookmarked: false };
  let suggestionTimer = null;

  function mount() {
    if (!document.documentElement.contains(host)) document.documentElement.append(host);
    document.documentElement.style.setProperty("padding-top", `${UI_HEIGHT}px`, "important");
    document.documentElement.style.setProperty("box-sizing", "border-box", "important");
  }

  function notify(message) {
    const status = shadow.querySelector("#status");
    status.textContent = message;
    status.classList.add("visible");
    setTimeout(() => status.classList.remove("visible"), 2200);
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Minova could not complete that action.");
    return response.result;
  }

  function renderTabs() {
    const tabs = shadow.querySelector("#tabs");
    tabs.replaceChildren();
    for (const tab of state.tabs) {
      const button = document.createElement("div");
      button.className = `tab${tab.id === state.activeTabId ? " active" : ""}`;
      button.dataset.tabId = String(tab.id);
      button.title = tab.title;
      button.tabIndex = 0;
      button.setAttribute("role", "button");

      if (tab.favIconUrl) {
        const icon = document.createElement("img");
        icon.src = tab.favIconUrl;
        icon.alt = "";
        button.append(icon);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "fallback";
        fallback.textContent = "M";
        button.append(fallback);
      }

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title || "New tab";
      button.append(title);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.dataset.closeTabId = String(tab.id);
      close.title = "Close tab";
      close.setAttribute("aria-label", "Close tab");
      close.textContent = "x";
      button.append(close);
      tabs.append(button);
    }
  }

  function renderState(nextState) {
    state = nextState || state;
    renderTabs();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (shadow.activeElement !== shadow.querySelector("#address")) shadow.querySelector("#address").value = active?.url || location.href;
    const bookmark = shadow.querySelector("#bookmark");
    bookmark.classList.toggle("active", Boolean(state.bookmarked));
    bookmark.innerHTML = state.bookmarked ? "&#x2605;" : "&#x2606;";
  }

  async function refresh() {
    try {
      renderState(await send({ type: "get-state" }));
    } catch (error) {
      notify(error.message);
    }
  }

  function hideSuggestions() {
    shadow.querySelector("#suggestions").classList.add("hidden");
  }

  function renderSuggestions(items) {
    const suggestions = shadow.querySelector("#suggestions");
    suggestions.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.className = "suggestion";
      button.type = "button";
      button.dataset.suggestionUrl = item.url;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const url = document.createElement("span");
      url.textContent = item.url;
      button.append(title, url);
      suggestions.append(button);
    }
    suggestions.classList.toggle("hidden", !items.length);
  }

  shadow.addEventListener("click", async (event) => {
    const closeTabId = event.target.closest("[data-close-tab-id]")?.dataset.closeTabId;
    const tabId = event.target.closest("[data-tab-id]")?.dataset.tabId;
    const action = event.target.closest("[data-action]")?.dataset.action;
    const windowAction = event.target.closest("[data-window]")?.dataset.window;
    const command = event.target.closest("[data-command]")?.dataset.command;
    const suggestionUrl = event.target.closest("[data-suggestion-url]")?.dataset.suggestionUrl;

    try {
      if (closeTabId) {
        event.stopPropagation();
        await send({ type: "close-tab", tabId: Number(closeTabId) });
      } else if (tabId) await send({ type: "activate-tab", tabId: Number(tabId) });
      else if (action) await send({ type: action });
      else if (windowAction) await send({ type: windowAction });
      else if (command) {
        shadow.querySelector("#menu").classList.add("hidden");
        await send({ type: "command", command });
      } else if (suggestionUrl) await send({ type: "navigate", value: suggestionUrl });
    } catch (error) {
      notify(error.message);
    }
  });
  shadow.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const tab = event.target.closest("[data-tab-id]");
    if (!tab || event.target.closest("[data-close-tab-id]")) return;
    event.preventDefault();
    send({ type: "activate-tab", tabId: Number(tab.dataset.tabId) }).catch((error) => notify(error.message));
  });

  shadow.querySelector("#newTab").addEventListener("click", () => send({ type: "new-tab" }).catch((error) => notify(error.message)));
  shadow.querySelector("#bookmark").addEventListener("click", () => send({ type: "toggle-bookmark" }).then(renderState).catch((error) => notify(error.message)));
  shadow.querySelector("#extensions").addEventListener("click", () => send({ type: "command", command: "extensions" }).catch((error) => notify(error.message)));
  shadow.querySelector("#menuButton").addEventListener("click", (event) => {
    event.stopPropagation();
    shadow.querySelector("#menu").classList.toggle("hidden");
  });
  shadow.querySelector("#navigation").addEventListener("submit", (event) => {
    event.preventDefault();
    hideSuggestions();
    send({ type: "navigate", value: shadow.querySelector("#address").value }).catch((error) => notify(error.message));
  });
  shadow.querySelector("#address").addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(async () => {
      try {
        renderSuggestions(await send({ type: "suggest", value: shadow.querySelector("#address").value }));
      } catch {
        hideSuggestions();
      }
    }, 120);
  });
  shadow.addEventListener("focusout", () => setTimeout(() => {
    if (!shadow.activeElement) hideSuggestions();
  }, 100));

  document.addEventListener("fullscreenchange", () => {
    const fullscreen = Boolean(document.fullscreenElement);
    host.style.display = fullscreen ? "none" : "block";
    document.documentElement.style.setProperty("padding-top", fullscreen ? "0" : `${UI_HEIGHT}px`, "important");
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "minova-state-changed") refresh();
  });

  mount();
  new MutationObserver(mount).observe(document, { childList: true });
  refresh();

  const testPort = new URLSearchParams(location.search).get("minova-hybrid-test");
  if (/^\d{4,5}$/.test(testPort || "")) {
    fetch(`http://127.0.0.1:${testPort}/injected?url=${encodeURIComponent(location.href)}`, { mode: "no-cors" }).catch(() => {});
  }
})();
