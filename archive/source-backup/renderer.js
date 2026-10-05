const SearchEngines = {
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
  brave: "https://search.brave.com/search?q=%s",
  custom: null
};

const THEME_COLOR_FIELDS = [
  ["background", "Page background", "The canvas behind tabs, pages, and settings"],
  ["panel", "Toolbar and panels", "The address bar, settings navigation, and menu surface"],
  ["panelAlt", "Buttons and active rows", "Raised controls, selected items, and hover states"],
  ["border", "Borders", "Dividers, outlines, and control edges"],
  ["text", "Primary text", "Headings, labels, and toolbar icons"],
  ["muted", "Secondary text", "Hints, inactive tabs, and supporting information"],
  ["accent", "Primary accent", "Focus rings, active controls, and highlights"],
  ["accentAlt", "Secondary accent", "Favicon and brand highlight color"],
  ["danger", "Warning color", "Errors, destructive actions, and warnings"]
];

const THEME_CSS_VARIABLES = {
  background: "--bg",
  panel: "--panel",
  panelAlt: "--panel-2",
  border: "--line",
  text: "--text",
  muted: "--muted",
  accent: "--accent",
  accentAlt: "--accent-2",
  danger: "--danger"
};

const DEFAULT_SHORTCUTS = [
  { id: "google", name: "Google", url: "https://www.google.com" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com" },
  { id: "github", name: "GitHub", url: "https://github.com" },
  { id: "news", name: "News", url: "https://news.ycombinator.com" }
];

const DEFAULT_WORKSPACES = [
  { id: "personal", name: "Personal", color: "#18c7be" },
  { id: "work", name: "Work", color: "#4d8dff" },
  { id: "gaming", name: "Gaming", color: "#ef6f9a" }
];
const EXPANDED_SIDEBAR_WIDTH = 272;
const COLLAPSED_SIDEBAR_WIDTH = 60;
const BASE_CHROME_HEIGHT = 102;
// Classic tabs share the titlebar row, so both interfaces expose the same
// content boundary to browser views and the Streaming Mode overlay.
const CLASSIC_CHROME_HEIGHT = BASE_CHROME_HEIGHT;

function readStoredArray(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredObject(key, fallback = {}) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

const legacyPasswords = readStoredArray("minova:passwords");
const savedSession = readStoredObject("minova:session", { tabs: [], activeIndex: 0 });

function normalizeWorkspaceDefinitions(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const workspaces = [];
  for (const entry of source) {
    const id = String(entry?.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    workspaces.push({
      id,
      name: String(entry?.name || id).trim().slice(0, 24) || id,
      color: normalizeHexColor(entry?.color) || "#18c7be",
      activeTabId: null,
      splitTabIds: []
    });
  }
  if (workspaces.length === 0) {
    for (const fallback of DEFAULT_WORKSPACES) {
      workspaces.push({ ...fallback, activeTabId: null, splitTabIds: [] });
    }
  }
  return workspaces.slice(0, 12);
}

const state = {
  tabs: [],
  activeTabId: null,
  workspaces: normalizeWorkspaceDefinitions(savedSession.workspaces),
  activeWorkspaceId: String(savedSession.activeWorkspaceId || "personal"),
  sidebarCollapsed: Boolean(savedSession.sidebarCollapsed),
  settings: null,
  version: null,
  bookmarks: readStoredArray("minova:bookmarks"),
  history: readStoredArray("minova:history"),
  searchHistory: readStoredArray("minova:search-history"),
  shortcuts: readStoredArray("minova:shortcuts", DEFAULT_SHORTCUTS),
  downloads: readStoredArray("minova:downloads"),
  closedTabs: readStoredArray("minova:closed-tabs"),
  pinnedExtensions: readStoredArray("minova:pinned-extensions"),
  passwords: [],
  extensions: [],
  tabPerformance: null,
  protectedContent: null,
  updater: null,
  streamingMode: {
    active: false,
    starting: false,
    backgrounded: false,
    browser: "",
    url: "",
    sourceTabId: "",
    presentation: "overlay",
    error: ""
  },
  assistantOpen: false,
  assistant: {
    status: "idle",
    modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    progress: 0,
    progressText: "Local model is not loaded",
    cached: false,
    webgpu: null,
    gpuVendor: "",
    compatibilityMode: false,
    busy: false,
    error: ""
  }
};
if (!state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) {
  state.activeWorkspaceId = state.workspaces[0]?.id || "personal";
}

const $ = (selector) => document.querySelector(selector);
const appShell = $(".app-shell");
const tabStrip = $("#tabStrip");
const workspaceList = $("#workspaceList");
const workspaceDialog = $("#workspaceDialog");
const newTabPage = $("#newTabPage");
const settingsPage = $("#settingsPage");
const omnibox = $("#omnibox");
const navigationForm = $("#navigationForm");
const securityChip = $("#securityChip");
const quickLinks = $("#quickLinks");
const shortcutDialog = $("#shortcutDialog");
const webStoreInstallBar = $("#webStoreInstallBar");
const webStoreInstallStatus = $("#webStoreInstallStatus");
const installWebStoreExtensionButton = $("#installWebStoreExtensionButton");
const pinnedExtensions = $("#pinnedExtensions");
const findBar = $("#findBar");
const findInput = $("#findInput");
const findResult = $("#findResult");
const toastHost = $("#toastHost");
const assistantSidebar = $("#assistantSidebar");
const assistantMessages = $("#assistantMessages");
const assistantInput = $("#assistantInput");

let visibleSuggestions = [];
let selectedSuggestionIndex = -1;
let dismissedWebStoreExtensionId = null;
let selectOmniboxOnMouseUp = false;
let mediaStatusRequest = 0;
let findState = { query: "", activeMatchOrdinal: 0, matches: 0 };
let findDebounce = null;
let browserLayoutRevision = 0;
let activeAssistantRequestId = "";
const assistantConversation = [];

function createId() {
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message, type = "info", duration = 3200) {
  const text = String(message || "").trim();
  if (!text) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = text;
  toastHost.replaceChildren(toast);
  window.setTimeout(() => {
    toast.classList.add("removing");
    window.setTimeout(() => toast.remove(), 160);
  }, duration);
}

function renderAssistantMessages() {
  if (!assistantConversation.length) {
    assistantMessages.innerHTML = `
      <div class="assistant-empty">
        <span class="assistant-mark" aria-hidden="true"><i></i></span>
        <span>Private local assistance, ready inside Minova.</span>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const message of assistantConversation) {
    const row = document.createElement("article");
    row.className = `assistant-message ${message.role}${message.pending ? " pending" : ""}`;
    const label = document.createElement("span");
    label.textContent = message.role === "user" ? "You" : "Minova";
    const copy = document.createElement("p");
    copy.textContent = message.content || (message.pending ? "" : "No response was generated.");
    row.append(label, copy);
    fragment.append(row);
  }
  assistantMessages.replaceChildren(fragment);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
}

function applyAssistantState(nextState = {}) {
  state.assistant = { ...state.assistant, ...nextState };
  const status = state.assistant.status;
  const loading = ["initializing", "downloading", "loading"].includes(status);
  const percent = Math.round(Math.max(0, Math.min(1, Number(state.assistant.progress) || 0)) * 100);
  const statusPanel = $("#assistantEngineStatus");
  statusPanel.classList.toggle("ready", status === "ready");
  statusPanel.classList.toggle("error", status === "error");
  statusPanel.classList.toggle("loading", loading);
  $("#assistantStatusText").textContent = state.assistant.error
    || state.assistant.progressText
    || (status === "ready" ? "Local model ready" : "Local model is not loaded");
  $("#assistantStatusPercent").textContent = loading ? `${percent}%` : "";
  $("#assistantProgressBar").style.width = `${status === "ready" ? 100 : percent}%`;
  $("#assistantSendButton").classList.toggle("hidden", Boolean(state.assistant.busy));
  $("#assistantStopButton").classList.toggle("hidden", !state.assistant.busy);
  $("#summarizePageButton").disabled = Boolean(state.assistant.busy)
    || (state.streamingMode.active && !state.streamingMode.backgrounded)
    || isInternalPage(getActiveTab()?.url || "minova://newtab");
  $("#newAssistantChatButton").disabled = Boolean(state.assistant.busy);
}

async function setAssistantOpen(open, { initialize = true, sync = true } = {}) {
  const nextOpen = Boolean(open);
  if (nextOpen && (state.streamingMode.active || state.streamingMode.starting)) {
    showToast("Close Streaming Mode before opening Minova Assistant.", "error");
    return false;
  }
  if (state.assistantOpen === nextOpen) return true;
  state.assistantOpen = nextOpen;
  appShell.classList.toggle("assistant-open", nextOpen);
  assistantSidebar.setAttribute("aria-hidden", String(!nextOpen));
  $("#assistantButton").classList.toggle("active", nextOpen);
  $("#assistantButton").setAttribute("aria-pressed", String(nextOpen));
  if (sync) await syncBrowserLayout({ focus: false });
  if (nextOpen && initialize) {
    renderAssistantMessages();
    applyAssistantState(state.assistant);
    window.minova.initializeAssistant().catch((error) => {
      applyAssistantState({ status: "error", error: error.message || "Local AI could not start." });
    });
    window.setTimeout(() => assistantInput.focus(), 190);
  }
  return true;
}

function assistantHistoryForRequest() {
  return assistantConversation
    .filter((message) => !message.pending && !message.error && message.content)
    .map(({ role, content }) => ({ role, content }))
    .slice(-14);
}

function createAssistantPendingMessage() {
  const message = { id: createId(), requestId: "", role: "assistant", content: "", pending: true, error: false };
  assistantConversation.push(message);
  renderAssistantMessages();
  return message;
}

async function sendAssistantChatMessage(text) {
  const content = String(text || "").trim();
  if (!content || state.assistant.busy) return;
  assistantConversation.push({ id: createId(), role: "user", content, pending: false, error: false });
  const pending = createAssistantPendingMessage();
  assistantInput.value = "";
  applyAssistantState({ busy: true, error: "" });
  try {
    const result = await window.minova.sendAssistantMessage(assistantHistoryForRequest());
    pending.requestId = result.requestId;
    activeAssistantRequestId = result.requestId;
  } catch (error) {
    pending.pending = false;
    pending.error = true;
    pending.content = error.message || "Minova Assistant could not answer.";
    applyAssistantState({ busy: false, error: pending.content });
    renderAssistantMessages();
  }
}

async function summarizeActivePageWithAssistant() {
  if (state.assistant.busy) return;
  assistantConversation.push({ id: createId(), role: "user", content: "Summarize this page", pending: false, error: false });
  const pending = createAssistantPendingMessage();
  applyAssistantState({ busy: true, error: "" });
  try {
    const result = await window.minova.summarizeActivePage();
    pending.requestId = result.requestId;
    activeAssistantRequestId = result.requestId;
  } catch (error) {
    pending.pending = false;
    pending.error = true;
    pending.content = error.message || "Minova could not summarize this page.";
    applyAssistantState({ busy: false, error: pending.content });
    renderAssistantMessages();
  }
}

function normalizeHexColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split("").map((character) => character.repeat(2)).join("")}`;
  }
  return "";
}

async function checkForUpdates(button = null) {
  if (button) button.disabled = true;
  showToast("Checking for Minova updates...");
  try {
    state.updater = await window.minova.checkForUpdates();
    const type = state.updater?.status === "error"
      ? "error"
      : ["up-to-date", "downloaded"].includes(state.updater?.status)
        ? "success"
        : "info";
    showToast(state.updater?.message || "The update check finished.", type, 5200);
    const status = $("#updateStatusText");
    if (status) status.textContent = state.updater?.message || "";
    return state.updater;
  } catch (error) {
    showToast(error.message || "Minova could not check for updates.", "error", 5200);
    return null;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function isRestorableTabUrl(url) {
  return /^(https?:\/\/|minova:\/\/)/i.test(String(url || ""));
}

function persistSession() {
  const restorableTabs = state.tabs
    .filter((tab) => !tab.private && isRestorableTabUrl(tab.url))
    .slice(0, 50);
  const tabs = restorableTabs
    .map((tab) => ({
      url: tab.url,
      title: tab.title || titleForUrl(tab.url),
      pinned: Boolean(tab.pinned),
      workspaceId: tab.workspaceId || "personal"
    }));
  const activeIndex = Math.max(0, restorableTabs.findIndex((tab) => tab.id === state.activeTabId));
  const workspaces = state.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    color: workspace.color,
    activeTabIndex: restorableTabs.findIndex((tab) => tab.id === workspace.activeTabId),
    splitTabIndices: workspace.splitTabIds
      .map((tabId) => restorableTabs.findIndex((tab) => tab.id === tabId))
      .filter((index) => index >= 0)
      .slice(0, 2)
  }));
  localStorage.setItem("minova:session", JSON.stringify({
    tabs,
    activeIndex,
    workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    sidebarCollapsed: state.sidebarCollapsed,
    savedAt: Date.now()
  }));
}

function persistClosedTabs() {
  state.closedTabs = state.closedTabs
    .filter((tab) => isRestorableTabUrl(tab.url))
    .slice(0, 20);
  localStorage.setItem("minova:closed-tabs", JSON.stringify(state.closedTabs));
  window.minova.updateQuickMenuState({ canReopenClosedTab: state.closedTabs.length > 0 });
}

function rememberClosedTab(tab) {
  if (!tab || tab.private || !isRestorableTabUrl(tab.url)) return;
  state.closedTabs.unshift({
    url: tab.url,
    title: tab.title || titleForUrl(tab.url),
    pinned: Boolean(tab.pinned),
    closedAt: Date.now()
  });
  persistClosedTabs();
}

function reopenClosedTab() {
  const closedTab = state.closedTabs.shift();
  if (!closedTab) {
    showToast("There are no recently closed tabs.");
    return null;
  }
  persistClosedTabs();
  const tab = openTab(closedTab.url, { pinned: Boolean(closedTab.pinned) });
  tab.title = closedTab.title || tab.title;
  renderTabs();
  showToast(`Reopened ${tab.title}`, "success", 2200);
  return tab;
}

function updateFindResult() {
  findResult.textContent = findState.matches
    ? `${findState.activeMatchOrdinal}/${findState.matches}`
    : findState.query
      ? "0/0"
      : "";
}

async function runFind(forward = true, findNext = false) {
  const tab = getActiveTab();
  const query = findInput.value.trim();
  findState.query = query;
  if (!tab || isInternalPage(tab.url) || !query) {
    findState = { query, activeMatchOrdinal: 0, matches: 0 };
    updateFindResult();
    return;
  }
  const result = await window.minova.findInBrowserTab(tab.id, query, { forward, findNext });
  if (result && typeof result === "object") {
    findState.activeMatchOrdinal = Number(result.activeMatchOrdinal) || 0;
    findState.matches = Number(result.matches) || 0;
    updateFindResult();
  }
}

function openFindBar() {
  const tab = getActiveTab();
  const streamingForeground = state.streamingMode.active && !state.streamingMode.backgrounded;
  if (!tab || isInternalPage(tab.url) || streamingForeground) {
    showToast("Find in page is available on regular webpages.");
    return;
  }
  findBar.classList.remove("hidden");
  findInput.focus();
  findInput.select();
  if (findInput.value.trim()) runFind(true, false);
}

async function closeFindBar() {
  findBar.classList.add("hidden");
  findState = { query: "", activeMatchOrdinal: 0, matches: 0 };
  findInput.value = "";
  updateFindResult();
  const tab = getActiveTab();
  if (tab && !isInternalPage(tab.url)) await window.minova.stopFindInBrowserTab(tab.id);
}

function normalizeUrl(input) {
  const value = input.trim();
  if (!value) return "minova://newtab";
  if (value === "minova://settings" || value === "chrome://settings") return "minova://settings";
  if (value === "minova://passwords" || value === "chrome://password-manager/passwords") return "minova://passwords";
  if (value === "minova://extensions" || value === "chrome://extensions") return "minova://extensions";
  if (value === "minova://history" || value === "chrome://history") return "minova://history";
  if (value === "minova://downloads" || value === "chrome://downloads") return "minova://downloads";
  if (value === "minova://bookmarks" || value === "chrome://bookmarks") return "minova://bookmarks";
  if (value === "minova://newtab" || value === "about:newtab") return "minova://newtab";

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const looksLikeDomain = /^localhost(:\d+)?(\/.*)?$/i.test(value) || /^(?!.*\s)([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value);
  if (hasScheme) return value;
  if (looksLikeDomain) return `https://${value}`;

  const template = state.settings.searchEngine === "custom"
    ? state.settings.customSearchUrl
    : SearchEngines[state.settings.searchEngine] || SearchEngines.google;
  return template.replace("%s", encodeURIComponent(value));
}

function isSearchInput(input) {
  const value = String(input || "").trim();
  if (!value || /^(minova|chrome):\/\//i.test(value) || value === "about:newtab") return false;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const looksLikeDomain = /^localhost(:\d+)?(\/.*)?$/i.test(value)
    || /^(?!.*\s)([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value);
  return !hasScheme && !looksLikeDomain;
}

function recordSearch(input) {
  const query = String(input || "").trim();
  if (!isSearchInput(query)) return;

  state.searchHistory = state.searchHistory
    .filter((entry) => String(entry.query || entry).toLowerCase() !== query.toLowerCase())
    .slice(0, 99);
  state.searchHistory.unshift({ query, searchedAt: Date.now() });
  localStorage.setItem("minova:search-history", JSON.stringify(state.searchHistory));
}

function extractSearchQuery(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const supportedHost = hostname === "google.com"
      || hostname.startsWith("google.")
      || hostname.includes(".google.")
      || hostname === "bing.com"
      || hostname.endsWith(".bing.com")
      || hostname === "duckduckgo.com"
      || hostname.endsWith(".duckduckgo.com")
      || hostname === "search.brave.com";
    return supportedHost ? parsed.searchParams.get("q")?.trim() || "" : "";
  } catch {
    return "";
  }
}

function getSearchSuggestions(input) {
  if (getActiveTab()?.private) return [];
  const term = input.trim().toLowerCase();
  if (!term) return [];

  const candidates = [];
  for (const entry of state.searchHistory) {
    const query = String(entry.query || entry).trim();
    if (query.toLowerCase().includes(term)) {
      candidates.push({
        kind: "search",
        value: query,
        primary: query,
        secondary: "Search again",
        timestamp: Number(entry.searchedAt) || 0
      });
    }
  }

  for (const entry of state.history) {
    const url = String(entry.url || "");
    const query = extractSearchQuery(url);
    if (query && query.toLowerCase().includes(term)) {
      candidates.push({
        kind: "search",
        value: query,
        primary: query,
        secondary: "Search again",
        timestamp: Number(entry.visitedAt) || 0
      });
      continue;
    }

    const title = String(entry.title || titleForUrl(url));
    if (`${title} ${url}`.toLowerCase().includes(term)) {
      candidates.push({
        kind: "history",
        value: url,
        primary: title,
        secondary: displayUrl(url),
        timestamp: Number(entry.visitedAt) || 0
      });
    }
  }

  const unique = new Map();
  for (const entry of candidates) {
    const key = `${entry.kind}:${entry.value.toLowerCase()}`;
    const existing = unique.get(key);
    if (!existing || entry.timestamp > existing.timestamp) unique.set(key, entry);
  }

  return [...unique.values()]
    .sort((a, b) => {
      const aStarts = `${a.primary} ${a.value}`.toLowerCase().startsWith(term) ? 1 : 0;
      const bStarts = `${b.primary} ${b.value}`.toLowerCase().startsWith(term) ? 1 : 0;
      return bStarts - aStarts || b.timestamp - a.timestamp;
    })
    .slice(0, 8);
}

function resetOmniboxSuggestions(hideNative = true) {
  visibleSuggestions = [];
  selectedSuggestionIndex = -1;
  omnibox.setAttribute("aria-expanded", "false");
  omnibox.removeAttribute("aria-activedescendant");
  if (hideNative) window.minova.hideOmniboxSuggestions().catch(() => {});
}

function hideOmniboxSuggestions() {
  resetOmniboxSuggestions(true);
}

function showNativeOmniboxSuggestions() {
  if (!visibleSuggestions.length) return;
  const bounds = navigationForm.getBoundingClientRect();
  window.minova.showOmniboxSuggestions({
    items: visibleSuggestions.map(({ kind, primary, secondary }) => ({ kind, primary, secondary })),
    selectedIndex: selectedSuggestionIndex,
    anchor: {
      left: bounds.left,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width
    }
  }).catch(() => resetOmniboxSuggestions(false));
}

function renderOmniboxSuggestions() {
  visibleSuggestions = getSearchSuggestions(omnibox.value);
  selectedSuggestionIndex = -1;

  if (!visibleSuggestions.length) {
    hideOmniboxSuggestions();
    return;
  }

  omnibox.setAttribute("aria-expanded", "true");
  showNativeOmniboxSuggestions();
}

function updateSuggestionSelection(nextIndex) {
  if (!visibleSuggestions.length) return;
  selectedSuggestionIndex = (nextIndex + visibleSuggestions.length) % visibleSuggestions.length;
  showNativeOmniboxSuggestions();
}

function useSuggestion(index) {
  const suggestion = visibleSuggestions[index];
  if (!suggestion) return;
  omnibox.value = suggestion.value;
  hideOmniboxSuggestions();
  navigateActive(suggestion.value);
}

function displayUrl(url) {
  if (url === "minova://newtab") return "";
  if (url.startsWith("minova://")) return url;
  return url;
}

function getChromeWebStoreExtensionId(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "chromewebstore.google.com") return null;
    return parsed.pathname.split("/").find((part) => /^[a-p]{32}$/.test(part)) || null;
  } catch {
    return null;
  }
}

function getYouTubeVideoId(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = null;
    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0];
    } else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
        videoId = parsed.pathname.split("/").filter(Boolean)[1];
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId || "") ? videoId : null;
  } catch {
    return null;
  }
}

function updateWebStoreInstallBar(url) {
  const extensionId = getChromeWebStoreExtensionId(url);
  const installed = extensionId && state.extensions.some((extension) => extension.id === extensionId);
  const installable = Boolean(extensionId && !installed && extensionId !== dismissedWebStoreExtensionId);
  webStoreInstallBar.classList.add("hidden");
  $("#extensionsButton").classList.toggle("store-installable", installable);
  $("#extensionsButton").title = installable ? "Add this extension to Minova" : "Extensions";
}

async function installCurrentWebStoreExtension() {
  const tab = getActiveTab();
  const extensionId = getChromeWebStoreExtensionId(tab?.url || "");
  if (!tab || !extensionId) return;

  installWebStoreExtensionButton.disabled = true;
  installWebStoreExtensionButton.textContent = "Installing...";
  webStoreInstallStatus.textContent = "Downloading from the Chrome Web Store...";

  try {
    const extension = await window.minova.installWebStoreExtension(tab.url);
    if (!extension) {
      webStoreInstallStatus.textContent = "Installation cancelled.";
      installWebStoreExtensionButton.textContent = "Add to Minova";
      installWebStoreExtensionButton.disabled = false;
      return;
    }
    state.extensions = [
      ...state.extensions.filter((item) => item.id !== extension.id),
      extension
    ];
    if (!state.pinnedExtensions.includes(extension.id)) state.pinnedExtensions.push(extension.id);
    persistPinnedExtensions();
    renderPinnedExtensions();
    webStoreInstallStatus.textContent = `${extension.name || "Extension"} was added to Minova.`;
    installWebStoreExtensionButton.textContent = "Installed";
    updateWebStoreInstallBar(tab.url);
  } catch (error) {
    webStoreInstallStatus.textContent = error.message || "Minova could not install this extension.";
    installWebStoreExtensionButton.textContent = "Try again";
    installWebStoreExtensionButton.disabled = false;
  }
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

function getWorkspace(workspaceId) {
  return state.workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

function getActiveWorkspace() {
  return getWorkspace(state.activeWorkspaceId) || state.workspaces[0] || null;
}

function getWorkspaceTabs(workspaceId) {
  return state.tabs.filter((tab) => tab.workspaceId === workspaceId);
}

function usesClassicTabLayout() {
  return state.settings?.tabLayout === "classic";
}

function sanitizeWorkspaceLayout(workspace) {
  if (!workspace) return;
  const workspaceTabIds = new Set(getWorkspaceTabs(workspace.id).map((tab) => tab.id));
  if (!workspaceTabIds.has(workspace.activeTabId)) workspace.activeTabId = null;
  workspace.splitTabIds = [...new Set(Array.isArray(workspace.splitTabIds) ? workspace.splitTabIds : [])]
    .filter((tabId) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      return workspaceTabIds.has(tabId) && tab && !isInternalPage(tab.url);
    })
    .slice(0, 2);
  if (workspace.splitTabIds.length !== 2) workspace.splitTabIds = [];
}

function renderWorkspaces() {
  workspaceList.replaceChildren();
  for (const workspace of state.workspaces) {
    const row = document.createElement("div");
    const button = document.createElement("button");
    const editButton = document.createElement("button");
    const active = workspace.id === state.activeWorkspaceId;
    const tabCount = getWorkspaceTabs(workspace.id).length;
    row.className = "workspace-row";
    row.dataset.workspaceId = workspace.id;
    button.type = "button";
    button.className = `workspace-button ${active ? "active" : ""}`;
    button.dataset.workspaceId = workspace.id;
    button.style.setProperty("--workspace-color", workspace.color);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.title = `${workspace.name} workspace`;
    button.innerHTML = `
      <span class="workspace-color" aria-hidden="true"></span>
      <span class="workspace-name">${escapeHtml(workspace.name)}</span>
      <span class="workspace-tab-count">${tabCount}</span>
    `;
    button.addEventListener("click", () => switchWorkspace(workspace.id));
    button.addEventListener("dblclick", () => openWorkspaceDialog(workspace.id));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openWorkspaceDialog(workspace.id);
    });
    editButton.type = "button";
    editButton.className = "workspace-edit-button";
    editButton.title = `Customize ${workspace.name}`;
    editButton.setAttribute("aria-label", `Customize ${workspace.name}`);
    editButton.textContent = "\u2026";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openWorkspaceDialog(workspace.id);
    });
    row.addEventListener("dragover", (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes("application/x-minova-tab-id")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      moveTabToWorkspace(event.dataTransfer?.getData("application/x-minova-tab-id"), workspace.id);
    });
    row.append(button, editButton);
    workspaceList.appendChild(row);
  }

  const workspace = getActiveWorkspace();
  $("#titlebarWorkspaceName").textContent = workspace?.name || "Minova";
}

function applySidebarState({ sync = true } = {}) {
  if (!usesClassicTabLayout() && (state.streamingMode.active || state.streamingMode.starting)) {
    state.sidebarCollapsed = true;
  }
  appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const toggle = $("#toggleSidebarButton");
  toggle.title = state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  toggle.setAttribute("aria-label", toggle.title);
  if (sync) syncBrowserLayout({ focus: false });
}

function applyInterfaceLayout({ sync = true } = {}) {
  const classic = usesClassicTabLayout();
  appShell.classList.toggle("classic-ui", classic);
  if (classic) {
    for (const workspace of state.workspaces) workspace.splitTabIds = [];
  }
  applySidebarState({ sync: false });
  renderWorkspaces();
  renderTabs();
  updateToolbar();
  if (sync) {
    syncBrowserLayout({
      focus: !isInternalPage(getActiveTab()?.url || "minova://newtab")
    });
  }
}

async function syncBrowserLayout({ focus = false } = {}) {
  const workspace = getActiveWorkspace();
  if (!workspace) return null;
  sanitizeWorkspaceLayout(workspace);

  const activeTab = getActiveTab();
  const visibleTabIds = workspace.splitTabIds.length === 2
    ? [...workspace.splitTabIds]
    : activeTab && activeTab.workspaceId === workspace.id && !isInternalPage(activeTab.url)
      ? [activeTab.id]
      : [];
  const visibleTabs = visibleTabIds
    .map((tabId) => state.tabs.find((tab) => tab.id === tabId))
    .filter((tab) => tab && !isInternalPage(tab.url));
  const revision = ++browserLayoutRevision;

  await Promise.all(visibleTabs.map((tab) => ensureBrowserTab(tab)));
  if (revision !== browserLayoutRevision) return null;

  return window.minova.setBrowserWorkspaceLayout({
    workspaces: state.workspaces.map(({ id, name, color }) => ({ id, name, color })),
    tabs: state.tabs
      .filter((tab) => !isInternalPage(tab.url))
      .map((tab) => {
        const workspaceDefinition = getWorkspace(tab.workspaceId);
        return {
          id: tab.id,
          workspaceId: tab.workspaceId,
          workspaceName: workspaceDefinition?.name || tab.workspaceId,
          workspaceColor: workspaceDefinition?.color || ""
        };
      }),
    activeWorkspaceId: workspace.id,
    activeTabIds: visibleTabIds,
    focusedTabId: visibleTabIds.includes(state.activeTabId) ? state.activeTabId : visibleTabIds[0] || null,
    sidebarWidth: usesClassicTabLayout()
      ? 0
      : state.sidebarCollapsed
        ? COLLAPSED_SIDEBAR_WIDTH
        : EXPANDED_SIDEBAR_WIDTH,
    chromeHeight: usesClassicTabLayout() ? CLASSIC_CHROME_HEIGHT : BASE_CHROME_HEIGHT,
    assistantWidth: state.assistantOpen
      ? Math.round(assistantSidebar.getBoundingClientRect().width)
      : 0,
    focus
  });
}

function switchWorkspace(workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace || workspace.id === state.activeWorkspaceId) return;
  const previousWorkspace = getActiveWorkspace();
  if (previousWorkspace) previousWorkspace.activeTabId = state.activeTabId;

  state.activeWorkspaceId = workspace.id;
  sanitizeWorkspaceLayout(workspace);
  const workspaceTabs = getWorkspaceTabs(workspace.id);
  const nextTab = state.tabs.find((tab) => tab.id === workspace.activeTabId)
    || workspaceTabs[0]
    || null;
  if (!nextTab) {
    openTab("minova://newtab", { workspaceId: workspace.id });
    return;
  }

  state.activeTabId = nextTab.id;
  workspace.activeTabId = nextTab.id;
  renderWorkspaces();
  renderTabs();
  renderPinnedExtensions();
  updateToolbar();
  renderInternalPage();
  refreshActiveMediaStatus();
  syncBrowserLayout({ focus: !isInternalPage(nextTab.url) });
  persistSession();
}

function moveTabToWorkspace(tabId, workspaceId) {
  const tab = state.tabs.find((entry) => entry.id === tabId);
  const targetWorkspace = getWorkspace(workspaceId);
  if (!tab || !targetWorkspace || tab.workspaceId === targetWorkspace.id) return;
  const sourceWorkspace = getWorkspace(tab.workspaceId);
  if (sourceWorkspace) {
    sourceWorkspace.splitTabIds = sourceWorkspace.splitTabIds.filter((id) => id !== tab.id);
    if (sourceWorkspace.splitTabIds.length !== 2) sourceWorkspace.splitTabIds = [];
    if (sourceWorkspace.activeTabId === tab.id) {
      sourceWorkspace.activeTabId = getWorkspaceTabs(sourceWorkspace.id).find((entry) => entry.id !== tab.id)?.id || null;
    }
  }

  tab.workspaceId = targetWorkspace.id;
  targetWorkspace.activeTabId = tab.id;
  targetWorkspace.splitTabIds = [];
  state.activeWorkspaceId = targetWorkspace.id;
  activateTab(tab.id);
  showToast(`Moved to ${targetWorkspace.name}.`, "success", 1800);
}

async function toggleSplitView() {
  const workspace = getActiveWorkspace();
  const activeTab = getActiveTab();
  if (usesClassicTabLayout()) {
    showToast("Switch to the workspace layout to use Split View.");
    return;
  }
  if (state.streamingMode.active || state.streamingMode.starting) {
    showToast("Exit Streaming Mode before opening split view.");
    return;
  }
  if (!workspace || !activeTab || activeTab.workspaceId !== workspace.id || isInternalPage(activeTab.url)) {
    showToast("Split view is available for webpages.");
    return;
  }

  sanitizeWorkspaceLayout(workspace);
  if (workspace.splitTabIds.length === 2) {
    workspace.splitTabIds = [];
    renderTabs();
    $("#splitViewButton").classList.remove("active");
    updateToolbar();
    await syncBrowserLayout({ focus: true });
    persistSession();
    return;
  }

  const companion = [...getWorkspaceTabs(workspace.id)]
    .reverse()
    .find((tab) => tab.id !== activeTab.id && !isInternalPage(tab.url));
  if (!companion) {
    showToast("Open a second webpage in this workspace to use split view.");
    return;
  }

  workspace.splitTabIds = [activeTab.id, companion.id];
  renderTabs();
  $("#splitViewButton").classList.add("active");
  updateToolbar();
  await syncBrowserLayout({ focus: true });
  persistSession();
}

function persistBookmarks() {
  localStorage.setItem("minova:bookmarks", JSON.stringify(state.bookmarks));
}

function persistHistory() {
  localStorage.setItem("minova:history", JSON.stringify(state.history.slice(0, 300)));
}

function clearAllHistory() {
  state.history = [];
  state.searchHistory = [];
  persistHistory();
  localStorage.removeItem("minova:search-history");
  window.minova.updateQuickMenuState({ history: [] });
  if (getActiveTab()?.url === "minova://history") renderHistory();
}

function persistShortcuts() {
  localStorage.setItem("minova:shortcuts", JSON.stringify(state.shortcuts));
}

function persistDownloads() {
  localStorage.setItem("minova:downloads", JSON.stringify(state.downloads.slice(0, 200)));
}

function persistPinnedExtensions() {
  localStorage.setItem("minova:pinned-extensions", JSON.stringify(state.pinnedExtensions));
}

function renderPinnedExtensions() {
  const installedIds = new Set(state.extensions.map((extension) => extension.id));
  const nextPinned = state.pinnedExtensions.filter((id) => installedIds.has(id));
  if (nextPinned.length !== state.pinnedExtensions.length) {
    state.pinnedExtensions = nextPinned;
    persistPinnedExtensions();
  }

  pinnedExtensions.replaceChildren();
  const activeTab = getActiveTab();
  if (activeTab?.private) {
    pinnedExtensions.classList.add("hidden");
    return;
  }
  for (const extensionId of state.pinnedExtensions) {
    const extension = state.extensions.find((item) => item.id === extensionId);
    if (!extension?.hasAction) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pinned-extension-button";
    button.id = extension.id;
    if (extension.icon) {
      const icon = document.createElement("img");
      icon.src = extension.icon;
      icon.alt = "";
      button.appendChild(icon);
    } else {
      button.classList.add("no-icon");
      button.dataset.letter = String(extension.name || "?").trim().charAt(0).toUpperCase() || "?";
    }
    button.title = extension.name || "Extension";
    button.setAttribute("aria-label", extension.name || "Extension");
    button.dataset.activeTab = activeTab?.nativeWebContentsId || "";
    button.addEventListener("click", async () => {
      try {
        await window.minova.openExtensionAction(extension.id);
      } catch (error) {
        showToast(error.message || "Minova could not open that extension.", "error");
      }
    });
    pinnedExtensions.appendChild(button);
  }
  pinnedExtensions.classList.toggle("hidden", !pinnedExtensions.childElementCount);
}

function extensionIconMarkup(extension) {
  if (extension.icon) {
    return `<img class="extension-list-icon" src="${escapeHtml(extension.icon)}" alt="" />`;
  }
  const initial = String(extension.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="extension-list-icon extension-fallback" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function recordHistory(url, title, tab) {
  if (tab?.private || !url || isInternalPage(url)) return;
  const latest = state.history[0];
  if (latest?.url === url && Date.now() - latest.visitedAt < 5000) return;
  state.history.unshift({ url, title: title || titleForUrl(url), visitedAt: Date.now() });
  persistHistory();
}

function titleForUrl(url) {
  if (url === "minova://newtab") return "New Tab";
  if (url === "minova://settings") return "Settings";
  if (url === "minova://passwords") return "Passwords";
  if (url === "minova://extensions") return "Extensions";
  if (url === "minova://history") return "History";
  if (url === "minova://downloads") return "Downloads";
  if (url === "minova://bookmarks") return "Bookmarks";
  if (url === "minova://about") return "About Minova";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Minova";
  }
}

function renderTabs() {
  tabStrip.innerHTML = "";
  const workspace = getActiveWorkspace();
  sanitizeWorkspaceLayout(workspace);
  const workspaceTabs = usesClassicTabLayout()
    ? state.tabs
    : getWorkspaceTabs(state.activeWorkspaceId);
  const splitTabIds = new Set(workspace?.splitTabIds || []);
  for (const tab of workspaceTabs) {
    const item = document.createElement("div");
    item.className = `tab ${tab.private ? "private" : ""} ${tab.pinned ? "pinned" : ""} ${tab.suspended ? "suspended" : ""} ${splitTabIds.has(tab.id) ? "in-split" : ""} ${tab.id === state.activeTabId ? "active" : ""}`;
    item.dataset.tabId = tab.id;
    item.draggable = true;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(tab.id === state.activeTabId));
    item.tabIndex = tab.id === state.activeTabId ? 0 : -1;
    const favicon = /^(https?:|data:image\/)/i.test(tab.favicon || "") ? tab.favicon : "";
    const faviconContent = tab.suspended
      ? `<span class="tab-suspended-icon" aria-hidden="true">z</span>`
      : tab.loading
      ? `<span class="tab-loading-dot" aria-hidden="true"></span>`
      : favicon
        ? `<img src="${escapeHtml(favicon)}" alt="" />`
        : tab.private
          ? `<span class="private-tab-glyph" aria-hidden="true"><i></i></span>`
          : "M";
    const tabTitle = tab.private && tab.url === "minova://newtab"
      ? "Private tab"
      : tab.title || titleForUrl(tab.url);
    item.setAttribute("aria-label", `${tabTitle}${tab.suspended ? ", suspended" : ""}${tab.pinned ? ", pinned" : ""}`);
    item.innerHTML = `
      <span class="tab-favicon ${favicon ? "has-image" : ""}">${faviconContent}</span>
      <span class="tab-title">${escapeHtml(tabTitle)}</span>
      <button class="tab-close" title="Close tab" aria-label="Close ${escapeHtml(tabTitle)}">&times;</button>
    `;
    item.addEventListener("click", (event) => {
      if (event.target.classList.contains("tab-close")) {
        closeTab(tab.id);
      } else {
        activateTab(tab.id);
      }
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      window.minova.showBrowserTabMenu(tab.id);
    });
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("application/x-minova-tab-id", tab.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateTab(tab.id);
      }
      if (event.key === "Delete") {
        event.preventDefault();
        closeTab(tab.id);
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const index = workspaceTabs.findIndex((entry) => entry.id === tab.id);
        const delta = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
        const next = workspaceTabs[(index + delta + workspaceTabs.length) % workspaceTabs.length];
        activateTab(next.id);
        tabStrip.querySelector(`[data-tab-id="${next.id}"]`)?.focus();
      }
    });
    tabStrip.appendChild(item);
  }
  $("#splitViewButton").classList.toggle("active", splitTabIds.size === 2);
  renderWorkspaces();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeShortcutUrl(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Enter a website address.");
  if (value.startsWith("minova://")) return value;

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid website address, such as example.com.");
  }
  if (!matchesWebProtocol(parsed.protocol)) {
    throw new Error("Shortcuts can only use HTTP, HTTPS, or Minova pages.");
  }
  return parsed.toString();
}

function matchesWebProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function shortcutInitial(name) {
  return name.trim().match(/[a-z0-9]/i)?.[0]?.toUpperCase() || "+";
}

function renderShortcuts() {
  quickLinks.innerHTML = `
    ${state.shortcuts.map((shortcut) => `
      <div class="shortcut-tile">
        <button type="button" class="shortcut-open" data-shortcut-open="${escapeHtml(shortcut.id)}" title="Open ${escapeHtml(shortcut.name)}">
          <span class="shortcut-icon" aria-hidden="true">${escapeHtml(shortcutInitial(shortcut.name))}</span>
          <span class="shortcut-label">${escapeHtml(shortcut.name)}</span>
        </button>
        <button type="button" class="shortcut-edit" data-shortcut-edit="${escapeHtml(shortcut.id)}" title="Edit ${escapeHtml(shortcut.name)}" aria-label="Edit ${escapeHtml(shortcut.name)}">...</button>
      </div>
    `).join("")}
    <button type="button" class="shortcut-tile shortcut-add" data-shortcut-add title="Add shortcut">
      <span class="shortcut-icon" aria-hidden="true">+</span>
      <span class="shortcut-label">Add shortcut</span>
    </button>
  `;
}

function openShortcutDialog(shortcutId = null) {
  const shortcut = state.shortcuts.find((item) => item.id === shortcutId);
  $("#shortcutDialogTitle").textContent = shortcut ? "Edit shortcut" : "Add shortcut";
  $("#shortcutId").value = shortcut?.id || "";
  $("#shortcutName").value = shortcut?.name || "";
  $("#shortcutUrl").value = shortcut?.url || "";
  $("#shortcutError").textContent = "";
  $("#deleteShortcutButton").classList.toggle("hidden", !shortcut);
  shortcutDialog.showModal();
  $("#shortcutName").focus();
}

function closeShortcutDialog() {
  if (shortcutDialog.open) shortcutDialog.close();
}

function saveShortcut(event) {
  event.preventDefault();
  const id = $("#shortcutId").value;
  const name = $("#shortcutName").value.trim();
  const error = $("#shortcutError");

  if (!name) {
    error.textContent = "Enter a name for this shortcut.";
    return;
  }

  try {
    const url = normalizeShortcutUrl($("#shortcutUrl").value);
    if (id) {
      state.shortcuts = state.shortcuts.map((shortcut) => (
        shortcut.id === id ? { ...shortcut, name: name.slice(0, 32), url } : shortcut
      ));
    } else {
      state.shortcuts.push({
        id: `shortcut-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: name.slice(0, 32),
        url
      });
    }
    persistShortcuts();
    renderShortcuts();
    closeShortcutDialog();
  } catch (shortcutError) {
    error.textContent = shortcutError.message;
  }
}

function deleteShortcut() {
  const id = $("#shortcutId").value;
  const shortcut = state.shortcuts.find((item) => item.id === id);
  if (!shortcut || !confirm(`Remove the ${shortcut.name} shortcut?`)) return;
  state.shortcuts = state.shortcuts.filter((item) => item.id !== id);
  persistShortcuts();
  renderShortcuts();
  closeShortcutDialog();
}

async function openWorkspaceDialog(workspaceId = null) {
  const workspace = getWorkspace(workspaceId);
  try {
    const result = await window.minova.openWorkspaceEditor({
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, color: workspace.color }
        : null,
      canDelete: Boolean(workspace && state.workspaces.length > 1),
      theme: getThemeSnapshot()
    });
    if (!result) return;
    if (result.action === "save") {
      applyWorkspaceEditorSave(workspace?.id || "", result.name, result.color);
    } else if (result.action === "delete" && workspace) {
      removeWorkspace(workspace.id);
    }
  } catch (error) {
    showToast(error.message || "Minova could not open the workspace editor.", "error");
  }
}

function closeWorkspaceDialog() {
  if (workspaceDialog.open) workspaceDialog.close();
}

function createWorkspaceId(name) {
  const base = String(name || "workspace")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "workspace";
  let candidate = base;
  let suffix = 2;
  while (getWorkspace(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function applyWorkspaceEditorSave(workspaceId, rawName, rawColor) {
  const name = String(rawName || "").trim().slice(0, 24);
  const color = normalizeHexColor(rawColor);
  if (!name || !color) return false;

  if (workspaceId) {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return false;
    workspace.name = name;
    workspace.color = color;
  } else {
    const workspace = {
      id: createWorkspaceId(name),
      name,
      color,
      activeTabId: null,
      splitTabIds: []
    };
    state.workspaces.push(workspace);
    state.activeWorkspaceId = workspace.id;
    renderWorkspaces();
    openTab("minova://newtab", { workspaceId: workspace.id });
    return true;
  }

  renderWorkspaces();
  syncBrowserLayout({ focus: false });
  persistSession();
  return true;
}

function removeWorkspace(workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace || state.workspaces.length <= 1) return false;
  const fallback = state.workspaces.find((entry) => entry.id !== workspace.id);
  if (!fallback) return false;

  for (const tab of getWorkspaceTabs(workspace.id)) tab.workspaceId = fallback.id;
  state.workspaces = state.workspaces.filter((entry) => entry.id !== workspace.id);
  if (state.activeWorkspaceId === workspace.id) {
    state.activeWorkspaceId = fallback.id;
    const nextTab = getWorkspaceTabs(fallback.id).find((tab) => tab.id === workspace.activeTabId)
      || getWorkspaceTabs(fallback.id)[0]
      || null;
    state.activeTabId = nextTab?.id || null;
    fallback.activeTabId = state.activeTabId;
  }

  renderWorkspaces();
  renderTabs();
  updateToolbar();
  renderInternalPage();
  syncBrowserLayout({ focus: !isInternalPage(getActiveTab()?.url || "minova://newtab") });
  persistSession();
  return true;
}

function saveWorkspace(event) {
  event.preventDefault();
  const id = $("#workspaceId").value;
  const name = $("#workspaceName").value.trim().slice(0, 24);
  const color = normalizeHexColor($("#workspaceColor").value);
  if (!name || !color) {
    $("#workspaceError").textContent = "Enter a workspace name and choose a color.";
    return;
  }

  closeWorkspaceDialog();
  applyWorkspaceEditorSave(id, name, color);
}

function deleteWorkspace() {
  const id = $("#workspaceId").value;
  const workspace = getWorkspace(id);
  if (!workspace || state.workspaces.length <= 1) return;
  const fallback = state.workspaces.find((entry) => entry.id !== workspace.id);
  if (!fallback || !confirm(`Remove the ${workspace.name} workspace? Its tabs will move to ${fallback.name}.`)) return;
  closeWorkspaceDialog();
  removeWorkspace(workspace.id);
}

function ensureBrowserTab(tab) {
  if (!tab.nativeReady) {
    const workspace = getWorkspace(tab.workspaceId) || getActiveWorkspace();
    tab.nativeReady = window.minova.createBrowserTab(tab.id, {
      private: Boolean(tab.private),
      pinned: Boolean(tab.pinned),
      workspaceId: workspace?.id || "personal",
      workspaceName: workspace?.name || "Personal",
      workspaceColor: workspace?.color || "#18c7be"
    }).then(async (details) => {
      tab.nativeWebContentsId = details?.webContentsId || null;
      tab.nativePrivate = Boolean(details?.private);
      await window.minova.setBrowserTabZoom(tab.id, state.settings.defaultZoom);
      if (tab.id === state.activeTabId) renderPinnedExtensions();
      return details;
    });
  }
  return tab.nativeReady;
}

function openTab(rawUrl = "minova://newtab", options = {}) {
  const activate = typeof options === "boolean" ? options : options.activate !== false;
  const privateTab = typeof options === "object" && Boolean(options.private);
  const pinnedTab = typeof options === "object" && Boolean(options.pinned);
  const requestedWorkspaceId = typeof options === "object" ? String(options.workspaceId || "") : "";
  const workspace = getWorkspace(requestedWorkspaceId) || getActiveWorkspace();
  const url = normalizeUrl(rawUrl);
  const tab = {
    id: createId(),
    workspaceId: workspace?.id || "personal",
    url,
    title: privateTab && url === "minova://newtab" ? "Private tab" : titleForUrl(url),
    private: privateTab,
    pinned: pinnedTab,
    suspended: false,
    suspendedAt: 0,
    loading: false,
    nativeReady: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    favicon: "",
    nativeWebContentsId: null,
    hasMedia: false,
    hasVideo: false,
    volumeBoost: 1
  };
  state.tabs.push(tab);
  if (activate && workspace) state.activeWorkspaceId = workspace.id;
  if (privateTab) ensureBrowserTab(tab).catch((error) => {
    tab.loadError = error.message || "Minova could not start private browsing.";
    updateToolbar();
  });
  renderTabs();
  if (activate) activateTab(tab.id);
  navigateTab(tab, tab.url, { activate: false });
  return tab;
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  const tab = state.tabs[index];
  const workspace = getWorkspace(tab.workspaceId);
  rememberClosedTab(tab);
  if (state.tabs.length === 1) {
    localStorage.setItem("minova:session", JSON.stringify({
      tabs: [],
      activeIndex: 0,
      workspaces: state.workspaces.map(({ id, name, color }) => ({ id, name, color })),
      activeWorkspaceId: state.activeWorkspaceId,
      sidebarCollapsed: state.sidebarCollapsed,
      savedAt: Date.now()
    }));
    window.minova.closeWindow();
    return;
  }
  state.tabs.splice(index, 1);
  for (const entry of state.workspaces) {
    entry.splitTabIds = entry.splitTabIds.filter((id) => id !== tabId);
    if (entry.splitTabIds.length !== 2) entry.splitTabIds = [];
    if (entry.activeTabId === tabId) entry.activeTabId = null;
  }
  window.minova.closeBrowserTab(tab.id);
  if (state.activeTabId === tabId) {
    const workspaceTabs = getWorkspaceTabs(tab.workspaceId);
    const next = workspaceTabs[Math.min(Math.max(0, index - 1), Math.max(0, workspaceTabs.length - 1))] || null;
    if (next) {
      activateTab(next.id);
    } else if (workspace?.id === state.activeWorkspaceId) {
      openTab("minova://newtab", { workspaceId: workspace.id });
    }
  } else if (workspace?.id === state.activeWorkspaceId) {
    syncBrowserLayout({ focus: false });
  }
  renderTabs();
  persistSession();
}

function activateTab(tabId) {
  if (!findBar.classList.contains("hidden")) closeFindBar();
  const tab = state.tabs.find((entry) => entry.id === tabId);
  if (!tab) return;
  const previousWorkspace = getActiveWorkspace();
  if (previousWorkspace && previousWorkspace.id !== tab.workspaceId) {
    previousWorkspace.activeTabId = state.activeTabId;
  }
  state.activeWorkspaceId = tab.workspaceId;
  const workspace = getWorkspace(tab.workspaceId);
  sanitizeWorkspaceLayout(workspace);
  if (workspace?.splitTabIds.length === 2) {
    if (!workspace.splitTabIds.includes(tab.id)) {
      if (isInternalPage(tab.url)) {
        workspace.splitTabIds = [];
      } else {
        const focusedIndex = Math.max(0, workspace.splitTabIds.indexOf(workspace.activeTabId));
        workspace.splitTabIds[focusedIndex] = tab.id;
        if (new Set(workspace.splitTabIds).size !== 2) workspace.splitTabIds = [];
      }
    }
  }
  state.activeTabId = tabId;
  if (workspace) workspace.activeTabId = tabId;
  syncBrowserLayout({ focus: !isInternalPage(tab.url) }).catch((error) => {
    tab.loadError = error.message || "Minova could not display this tab.";
    updateToolbar();
  });
  renderTabs();
  renderPinnedExtensions();
  updateToolbar();
  renderInternalPage();
  refreshActiveMediaStatus();
  persistSession();
}

function isInternalPage(url) {
  return url.startsWith("minova://");
}

function navigateActive(rawUrl) {
  const tab = getActiveTab();
  if (!tab) return;
  if (!tab.private) recordSearch(rawUrl);
  hideOmniboxSuggestions();
  if (document.activeElement === omnibox) omnibox.blur();
  navigateTab(tab, normalizeUrl(rawUrl));
}

function navigateTab(tab, url, { activate = true } = {}) {
  tab.url = url;
  tab.title = titleForUrl(url);
  tab.loadError = null;
  if (isInternalPage(url)) {
    tab.loading = false;
    const workspace = getWorkspace(tab.workspaceId);
    if (workspace) workspace.splitTabIds = [];
    if (tab.id === state.activeTabId) syncBrowserLayout({ focus: false });
    renderTabs();
    updateToolbar();
    renderInternalPage();
    persistSession();
    return;
  }
  newTabPage.classList.add("hidden");
  settingsPage.classList.add("hidden");
  if (activate) activateTab(tab.id);
  tab.loading = true;
  renderTabs();
  ensureBrowserTab(tab).then(async () => {
    await window.minova.navigateBrowserTab(tab.id, url);
    if (tab.id === state.activeTabId) await syncBrowserLayout({ focus: true });
    persistSession();
  }).catch((error) => {
    tab.loading = false;
    tab.loadError = error.message || "This page could not be loaded.";
    renderTabs();
    updateToolbar();
    persistSession();
  });
}

function updateToolbar() {
  const tab = getActiveTab();
  if (!tab) return;
  const streamingSessionActive = state.streamingMode.active || state.streamingMode.starting;
  const streamingForeground = streamingSessionActive && !state.streamingMode.backgrounded;
  const splitViewActive = getActiveWorkspace()?.splitTabIds.length === 2;
  if (document.activeElement !== omnibox) {
    omnibox.value = displayUrl(streamingForeground ? state.streamingMode.url : tab.url);
  }
  omnibox.readOnly = streamingForeground;
  navigationForm.classList.toggle("streaming", streamingForeground);
  appShell.classList.toggle("streaming-active", streamingForeground);
  $("#exitStreamingModeButton").classList.toggle("hidden", !streamingForeground);
  $("#exitStreamingModeButton").title = state.streamingMode.starting ? "Cancel Streaming Mode" : "Exit Streaming Mode";
  $("#exitStreamingModeButton").setAttribute("aria-label", state.streamingMode.starting ? "Cancel Streaming Mode" : "Exit Streaming Mode");
  $("#resumeStreamingModeButton").classList.toggle("hidden", !state.streamingMode.active || !state.streamingMode.backgrounded);
  $("#homeButton").classList.toggle("hidden", !state.settings.showHomeButton);
  const isSecure = tab.url.startsWith("https://");
  const isInternal = tab.url.startsWith("minova://");
  $("#backButton").disabled = streamingForeground
    ? state.streamingMode.starting
    : isInternal || !tab.canGoBack;
  $("#forwardButton").disabled = streamingForeground
    ? state.streamingMode.starting
    : isInternal || !tab.canGoForward;
  $("#reloadButton").disabled = state.streamingMode.starting && streamingForeground;
  $("#homeButton").disabled = streamingForeground;
  securityChip.textContent = streamingForeground ? (state.streamingMode.starting ? "Starting" : "Streaming") : tab.private ? "Private" : tab.loadError ? "Offline" : isInternal ? "Minova" : isSecure ? "Secure" : "Info";
  securityChip.className = `security-chip ${streamingForeground || isSecure ? "secure" : ""} ${tab.private && !streamingForeground ? "private" : ""}`;
  updateWebStoreInstallBar(tab.url);
  $("#streamingModeButton").disabled = streamingSessionActive || splitViewActive || isInternal || !tab.url.startsWith("https://");
  $("#streamingModeButton").title = splitViewActive
    ? "Exit Split View to use Streaming Mode"
    : "Open in Streaming Mode";
  $("#streamingModeButton").setAttribute("aria-label", $("#streamingModeButton").title);
  $("#streamingModeButton").classList.toggle("hidden", streamingSessionActive);
  $("#popoutButton").disabled = streamingForeground || isInternal || !tab.hasVideo;
  $("#volumeButton").disabled = streamingForeground || isInternal;
  $("#assistantButton").disabled = streamingSessionActive;
  $("#assistantButton").classList.toggle("active", state.assistantOpen);
  $("#splitViewButton").disabled = streamingSessionActive || usesClassicTabLayout();
  $("#volumeButton").classList.toggle("active", Number(tab.volumeBoost) > 1);
  $("#bookmarkButton").textContent = state.bookmarks.includes(tab.url) ? "★" : "☆";
  applyAssistantState(state.assistant);
}

function renderInternalPage() {
  const tab = getActiveTab();
  if (!tab) return;
  const showingNewTab = tab.url === "minova://newtab";
  const showingSettings = tab.url === "minova://settings";
  const showingPasswords = tab.url === "minova://passwords";
  const showingExtensions = tab.url === "minova://extensions";
  const showingHistory = tab.url === "minova://history";
  const showingDownloads = tab.url === "minova://downloads";
  const showingBookmarks = tab.url === "minova://bookmarks";
  const showingAbout = tab.url === "minova://about";
  newTabPage.classList.toggle("hidden", !showingNewTab);
  newTabPage.classList.toggle("private", showingNewTab && tab.private);
  $("#privateNewTabNotice").classList.toggle("hidden", !(showingNewTab && tab.private));
  settingsPage.classList.toggle("hidden", !(showingSettings || showingPasswords || showingExtensions || showingHistory || showingDownloads || showingBookmarks || showingAbout));
  settingsPage.classList.remove("standalone");
  if (showingSettings) renderSettings();
  if (showingPasswords) renderPasswords();
  if (showingExtensions) renderExtensions();
  if (showingHistory) renderHistory();
  if (showingDownloads) renderDownloads();
  if (showingBookmarks) renderBookmarks();
  if (showingAbout) renderSettings("about");
}

function renderSettings(active = "profile") {
  const categories = [
    ["profile", "You and Minova"],
    ["appearance", "Appearance"],
    ["search", "Search engine"],
    ["startup", "On startup"],
    ["passwords", "Passwords and autofill"],
    ["privacy", "Privacy and security"],
    ["permissions", "Site settings"],
    ["downloads", "Downloads"],
    ["history", "History"],
    ["bookmarks", "Bookmarks"],
    ["extensions", "Extensions"],
    ["performance", "Tab Performance"],
    ["system", "System"],
    ["about", "About Minova"]
  ];

  settingsPage.innerHTML = `
    <aside class="settings-nav">
      <div class="settings-brand"><img src="../assets/logos/minova-browser.png" alt="" />Minova</div>
      ${categories.map(([id, label]) => `<button class="${id === active ? "active" : ""}" data-settings-tab="${id}">${label}</button>`).join("")}
    </aside>
    <div class="settings-content">
      ${settingsPanel(active)}
    </div>
  `;

  settingsPage.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.settingsTab === "passwords") {
        navigateActive("minova://passwords");
      } else if (button.dataset.settingsTab === "extensions") {
        navigateActive("minova://extensions");
      } else if (button.dataset.settingsTab === "history") {
        navigateActive("minova://history");
      } else if (button.dataset.settingsTab === "bookmarks") {
        navigateActive("minova://bookmarks");
      } else {
        renderSettings(button.dataset.settingsTab);
      }
    });
  });
  bindSettingsControls(active);
  if (active === "performance") {
    window.minova.getTabPerformanceStatus().then((status) => {
      if (settingsPage.querySelector('[data-settings-tab="performance"].active')) {
        state.tabPerformance = status;
        $("#suspendedTabCount").textContent = String(status.suspendedTabs);
      }
    });
  }
}

function settingsPanel(active) {
  const s = state.settings;
  const protectedContent = state.protectedContent || state.version?.protectedContent || {};
  const protectedContentLabel = protectedContent.ready
    ? `Widevine ${protectedContent.version || "ready"}`
    : protectedContent.runtime === "ecs"
      ? "Widevine unavailable"
      : "ECS runtime required";
  const protectedContentError = protectedContent.errors?.[0]?.message || "";
  const protectedContentFileCount = (protectedContent.files?.libraries || []).length;
  const panels = {
    profile: `
      <h2>You and Minova</h2>
      <section class="settings-section">
        <h3>Profile</h3>
        <p>Minova stores its browser profile securely on this computer.</p>
        <div class="setting-row"><span>Bookmarks saved locally</span><strong>${state.bookmarks.length}</strong></div>
        <div class="setting-row"><span>Passwords protected by Windows encryption</span><strong>${state.passwords.length}</strong></div>
        <div class="setting-row"><span>Installed extensions</span><strong>${state.extensions.length}</strong></div>
      </section>
      <section class="settings-section">
        <h3>Google services</h3>
        <p>You can stay signed in to Google websites in Minova. Chrome Sync for bookmarks and passwords is available only inside Google Chrome.</p>
        <button class="primary-action" id="signInGoogleButton">Sign in to Google</button>
        <button class="secondary-action" id="openGooglePasswordsFromProfileButton">Google Password Manager</button>
        <button class="secondary-action" id="replayMinovaTourButton">Take the Minova tour again</button>
      </section>`,
    appearance: `
      <h2>Appearance</h2>
      <section class="settings-section">
        ${selectRow("Tab layout", "tabLayout", s.tabLayout || "workspaces", [["workspaces", "Workspace sidebar"], ["classic", "Classic horizontal tabs"]])}
        <p>Workspace mode includes customizable spaces and Split View. Classic mode uses a traditional horizontal tab bar.</p>
        ${selectRow("Theme", "theme", s.theme, [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["custom", "Custom"]])}
        ${toggleRow("Show Home button", "showHomeButton", s.showHomeButton)}
        ${inputRow("Home page", "homeUrl", s.homeUrl)}
        ${rangeRow("Page zoom", "defaultZoom", s.defaultZoom, 0.75, 1.5, 0.05)}
      </section>
      ${s.theme === "custom" ? `
        <section class="settings-section custom-theme-section">
          <h3>Custom colors</h3>
          <p>Choose every color in Minova's browser interface. Changes preview immediately and are saved automatically.</p>
          ${themeColorRows(s.customThemeColors)}
          <button class="secondary-action" id="resetCustomThemeButton">Reset custom colors</button>
        </section>` : ""}`,
    search: `
      <h2>Search Engine</h2>
      <section class="settings-section">
        ${selectRow("Search engine used in the address bar", "searchEngine", s.searchEngine, [["google", "Google"], ["bing", "Bing"], ["duckduckgo", "DuckDuckGo"], ["brave", "Brave"], ["custom", "Custom"]])}
        ${inputRow("Custom search URL", "customSearchUrl", s.customSearchUrl)}
      </section>`,
    startup: `
      <h2>On Startup</h2>
      <section class="settings-section">
        ${selectRow("When Minova starts", "startupMode", s.startupMode || "continue", [["continue", "Continue where you left off"], ["newtab", "Open the New Tab page"], ["specific", "Open a specific page"]])}
        ${inputRow("Open this page", "startupUrl", s.startupUrl)}
      </section>`,
    passwords: `
      <h2>Passwords and Autofill</h2>
      <section class="settings-section">
        <p>Save and manage site logins in Minova's local password manager.</p>
        ${toggleRow("Autofill a matching login when exactly one account is saved", "autofillPasswords", s.autofillPasswords)}
        <button class="primary-action" id="openPasswordsButton">Open password manager</button>
      </section>`,
    privacy: `
      <h2>Privacy and Security</h2>
      <section class="settings-section">
        ${toggleRow("Block ads and trackers", "adBlockEnabled", s.adBlockEnabled)}
        ${toggleRow("Block pop-up windows", "blockPopups", s.blockPopups)}
        ${toggleRow("Send a Do Not Track request", "sendDoNotTrack", s.sendDoNotTrack)}
        ${toggleRow("Clear browsing data when Minova closes", "clearBrowsingDataOnExit", s.clearBrowsingDataOnExit)}
        <button class="primary-action" id="clearDataButton">Clear browsing data now</button>
      </section>`,
    permissions: `
      <h2>Site Settings</h2>
      <section class="settings-section">
        ${selectRow("Notifications", "allowNotifications", s.allowNotifications, permissionOptions())}
        ${selectRow("Camera", "allowCamera", s.allowCamera, permissionOptions())}
        ${selectRow("Microphone", "allowMicrophone", s.allowMicrophone, permissionOptions())}
        ${selectRow("Location", "allowLocation", s.allowLocation, permissionOptions())}
      </section>`,
    downloads: `
      <h2>Downloads</h2>
      <section class="settings-section">
        ${inputRow("Download location", "downloadPath", s.downloadPath)}
        ${toggleRow("Ask where to save each file", "askDownloadLocation", s.askDownloadLocation)}
        <button class="primary-action" id="openDownloadsButton">Open downloads</button>
      </section>`,
    history: `
      <h2>History</h2>
      <section class="settings-section">
        <p>${state.history.length} visited pages saved locally.</p>
        <button class="primary-action" id="openHistoryButton">Open history</button>
      </section>`,
    bookmarks: `
      <h2>Bookmarks</h2>
      <section class="settings-section">
        <p>${state.bookmarks.length} bookmarks saved locally.</p>
        <button class="primary-action" id="openBookmarksButton">Open bookmarks</button>
      </section>`,
    extensions: `
      <h2>Extensions</h2>
      <section class="settings-section">
        <p>Load real unpacked Chrome extensions from a folder that contains manifest.json.</p>
        <button class="primary-action" id="openExtensionsButton">Open extensions</button>
      </section>`,
    performance: `
      <h2>Tab Performance</h2>
      <section class="settings-section">
        ${toggleRow("Enable Smart Tab Suspension", "smartTabSuspensionEnabled", s.smartTabSuspensionEnabled)}
        ${selectRow("Suspension timeout", "tabSuspensionPreset", s.tabSuspensionPreset || "30", [["15", "15 Minutes"], ["30", "30 Minutes"], ["60", "1 Hour"], ["custom", "Custom"]])}
        ${(s.tabSuspensionPreset || "30") === "custom"
          ? `<label class="setting-row vertical">
              <span>Custom timeout</span>
              <span class="duration-control">
                <input id="tabSuspensionCustomValue" type="number" min="${s.tabSuspensionCustomUnit === "hours" ? 0.02 : 1}" max="${s.tabSuspensionCustomUnit === "hours" ? 24 : 1440}" step="${s.tabSuspensionCustomUnit === "hours" ? 0.01 : 1}" value="${s.tabSuspensionCustomUnit === "hours" ? Math.round(((Number(s.tabSuspensionTimeoutMinutes) || 30) / 60) * 100) / 100 : Number(s.tabSuspensionTimeoutMinutes) || 30}" />
                <select id="tabSuspensionCustomUnit" aria-label="Custom timeout unit">
                  <option value="minutes" ${s.tabSuspensionCustomUnit !== "hours" ? "selected" : ""}>Minutes</option>
                  <option value="hours" ${s.tabSuspensionCustomUnit === "hours" ? "selected" : ""}>Hours</option>
                </select>
              </span>
            </label>`
          : ""}
        ${toggleRow("Never suspend pinned tabs", "neverSuspendPinnedTabs", s.neverSuspendPinnedTabs)}
        ${toggleRow("Never suspend tabs playing audio or video", "neverSuspendAudioTabs", s.neverSuspendAudioTabs)}
        ${toggleRow("Never suspend tabs with unsaved changes or selected uploads", "neverSuspendUnsavedTabs", s.neverSuspendUnsavedTabs)}
        ${toggleRow("Never suspend tabs using camera or microphone", "neverSuspendCaptureTabs", s.neverSuspendCaptureTabs)}
        <label class="setting-row vertical">
          <span>Website exclusion list</span>
          <textarea id="tabSuspensionExclusions" rows="5" placeholder="example.com&#10;meet.example.org">${escapeHtml((s.tabSuspensionExclusions || []).join("\n"))}</textarea>
        </label>
        <p>One website per line. Subdomains are included automatically.</p>
        <div class="setting-row"><span>Suspended tabs</span><strong id="suspendedTabCount">${state.tabPerformance?.suspendedTabs || state.tabs.filter((tab) => tab.suspended).length}</strong></div>
        <button class="secondary-action" id="suspendTabsNowButton">Check inactive tabs now</button>
      </section>`,
    system: `
      <h2>System</h2>
      <section class="settings-section">
        ${toggleRow("Use spell check", "spellcheck", s.spellcheck)}
        ${toggleRow("Use hardware acceleration when available", "hardwareAcceleration", s.hardwareAcceleration)}
        <div class="setting-row"><span>Protected content</span><strong>${escapeHtml(protectedContentLabel)}</strong></div>
        ${protectedContentFileCount ? `<p>${protectedContentFileCount} Widevine CDM library found.</p>` : ""}
        ${protectedContentError ? `<p>${escapeHtml(protectedContentError)}</p>` : ""}
        <button class="secondary-action" id="refreshProtectedContentButton">Check protected content</button>
        <button class="secondary-action" id="openVmpTestButton">Open VMP test</button>
      </section>`,
    about: `
      <h2>About Minova</h2>
      <section class="settings-section about-panel">
        <img src="../assets/logos/minova-browser.png" alt="Minova" />
        <div>
          <h3>Minova</h3>
          <p>Version ${state.version.minova}</p>
          <p>Chromium ${state.version.chrome}</p>
          <p>Electron ${state.version.electron}</p>
          <p>Protected content ${escapeHtml(protectedContentLabel)}</p>
          <p>License ${state.version.license}</p>
          <p>Free software provided without warranty.</p>
        </div>
      </section>
      <section class="settings-section update-settings-section">
        <div class="setting-row">
          <span>Browser updates</span>
          <strong>Version ${escapeHtml(state.version.minova)}</strong>
        </div>
        <p id="updateStatusText">${escapeHtml(state.updater?.message || "Minova checks for updates automatically.")}</p>
        <button class="primary-action" id="checkUpdatesButton">Check for updates</button>
      </section>
      <button class="secondary-action" id="viewLicenseButton">View GPL license</button>
      <button class="secondary-action" id="resetSettingsButton">Restore settings to defaults</button>`
  };
  return panels[active] || panels.profile;
}

function permissionOptions() {
  return [["ask", "Ask first"], ["allow", "Allow"], ["block", "Block"]];
}

function toggleRow(label, key, checked) {
  return `<label class="setting-row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""} /></label>`;
}

function inputRow(label, key, value) {
  return `<label class="setting-row vertical"><span>${label}</span><input type="text" data-setting="${key}" value="${escapeHtml(value)}" /></label>`;
}

function selectRow(label, key, value, options) {
  return `<label class="setting-row"><span>${label}</span><select data-setting="${key}">${options.map(([id, text]) => `<option value="${id}" ${id === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function rangeRow(label, key, value, min, max, step) {
  return `<label class="setting-row"><span>${label}</span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${value}" /><strong>${Math.round(value * 100)}%</strong></label>`;
}

function themeColorRows(colors = {}) {
  return THEME_COLOR_FIELDS.map(([key, label, description]) => {
    const value = normalizeHexColor(colors[key]) || "#000000";
    return `
      <label class="setting-row theme-color-row">
        <span class="theme-color-copy"><strong>${label}</strong><small>${description}</small></span>
        <span class="theme-color-control">
          <input type="color" value="${value}" data-theme-color="${key}" aria-label="${label}" />
          <input type="text" value="${value}" data-theme-color-text="${key}" aria-label="${label} hex color" maxlength="7" spellcheck="false" />
        </span>
      </label>`;
  }).join("");
}

function bindSettingsControls() {
  settingsPage.querySelectorAll("[data-setting]").forEach((control) => {
    control.addEventListener("change", async () => {
      const key = control.dataset.setting;
      const value = control.type === "checkbox"
        ? control.checked
        : ["range", "number"].includes(control.type)
          ? Number(control.value)
          : control.value;
      const update = { [key]: value };
      if (key === "tabSuspensionPreset" && value !== "custom") {
        update.tabSuspensionTimeoutMinutes = Number(value);
      }
      state.settings = await window.minova.setSettings(update);
      applyTheme();
      if (key === "tabLayout") {
        applyInterfaceLayout();
      } else {
        updateToolbar();
      }
      renderSettings(settingsPage.querySelector(".settings-nav .active")?.dataset.settingsTab || "profile");
    });
  });
  const previewCustomThemeColor = (key, value) => {
    state.settings = {
      ...state.settings,
      theme: "custom",
      customThemeColors: {
        ...state.settings.customThemeColors,
        [key]: value
      }
    };
    applyTheme();
  };
  const saveCustomThemeColor = async (key, value) => {
    previewCustomThemeColor(key, value);
    state.settings = await window.minova.setSettings({
      theme: "custom",
      customThemeColors: state.settings.customThemeColors
    });
    applyTheme();
  };
  settingsPage.querySelectorAll("[data-theme-color]").forEach((control) => {
    control.addEventListener("input", () => {
      const key = control.dataset.themeColor;
      const value = normalizeHexColor(control.value);
      if (!value) return;
      const textControl = settingsPage.querySelector(`[data-theme-color-text="${key}"]`);
      if (textControl) textControl.value = value;
      previewCustomThemeColor(key, value);
    });
    control.addEventListener("change", () => {
      const value = normalizeHexColor(control.value);
      if (value) void saveCustomThemeColor(control.dataset.themeColor, value);
    });
  });
  settingsPage.querySelectorAll("[data-theme-color-text]").forEach((control) => {
    control.addEventListener("change", async () => {
      const value = normalizeHexColor(control.value);
      if (!value) {
        showToast("Enter a color as a hex value, such as #18c7be.", "error");
        renderSettings("appearance");
        return;
      }
      const colorControl = settingsPage.querySelector(`[data-theme-color="${control.dataset.themeColorText}"]`);
      if (colorControl) colorControl.value = value;
      control.value = value;
      await saveCustomThemeColor(control.dataset.themeColorText, value);
    });
  });
  $("#resetCustomThemeButton")?.addEventListener("click", async () => {
    state.settings = await window.minova.resetCustomTheme();
    applyTheme();
    renderSettings("appearance");
    showToast("Custom colors restored.", "success");
  });
  const saveCustomSuspensionTimeout = async () => {
    const input = $("#tabSuspensionCustomValue");
    const unitControl = $("#tabSuspensionCustomUnit");
    if (!input || !unitControl) return;
    const unit = unitControl.value === "hours" ? "hours" : "minutes";
    const value = Number(input.value);
    const minutes = unit === "hours" ? Math.round(value * 60) : value;
    if (!Number.isFinite(value) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      showToast(unit === "hours"
        ? "Enter a duration up to 24 hours."
        : "Enter a whole number from 1 to 1,440 minutes.", "error");
      renderSettings("performance");
      return;
    }
    state.settings = await window.minova.setSettings({
      tabSuspensionPreset: "custom",
      tabSuspensionCustomUnit: unit,
      tabSuspensionTimeoutMinutes: minutes
    });
    renderSettings("performance");
  };
  $("#tabSuspensionCustomValue")?.addEventListener("change", saveCustomSuspensionTimeout);
  $("#tabSuspensionCustomUnit")?.addEventListener("change", async (event) => {
    const unit = event.currentTarget.value === "hours" ? "hours" : "minutes";
    const input = $("#tabSuspensionCustomValue");
    if (input) {
      input.min = unit === "hours" ? "0.02" : "1";
      input.max = unit === "hours" ? "24" : "1440";
      input.step = unit === "hours" ? "0.01" : "1";
      input.value = unit === "hours"
        ? String(Math.round(((Number(state.settings.tabSuspensionTimeoutMinutes) || 30) / 60) * 100) / 100)
        : String(Number(state.settings.tabSuspensionTimeoutMinutes) || 30);
    }
    await saveCustomSuspensionTimeout();
  });
  $("#tabSuspensionExclusions")?.addEventListener("change", async (event) => {
    const exclusions = event.currentTarget.value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 100);
    state.settings = await window.minova.setSettings({ tabSuspensionExclusions: exclusions });
    renderSettings("performance");
  });
  $("#suspendTabsNowButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const suspended = await window.minova.suspendInactiveTabsNow();
      state.tabPerformance = await window.minova.getTabPerformanceStatus();
      $("#suspendedTabCount").textContent = String(state.tabPerformance.suspendedTabs);
      showToast(suspended ? `Suspended ${suspended} inactive tab${suspended === 1 ? "" : "s"}.` : "No inactive tabs were eligible.", "success");
    } finally {
      button.disabled = false;
    }
  });
  $("#clearDataButton")?.addEventListener("click", async () => {
    await window.minova.clearBrowsingData();
    clearAllHistory();
    showToast("Browsing data cleared.", "success");
  });
  $("#resetSettingsButton")?.addEventListener("click", async () => {
    state.settings = await window.minova.resetSettings();
    applyTheme();
    applyInterfaceLayout();
    renderSettings("about");
  });
  $("#viewLicenseButton")?.addEventListener("click", () => window.minova.openLicense());
  $("#checkUpdatesButton")?.addEventListener("click", (event) => checkForUpdates(event.currentTarget));
  $("#openPasswordsButton")?.addEventListener("click", () => navigateActive("minova://passwords"));
  $("#openExtensionsButton")?.addEventListener("click", () => navigateActive("minova://extensions"));
  $("#openDownloadsButton")?.addEventListener("click", () => navigateActive("minova://downloads"));
  $("#openHistoryButton")?.addEventListener("click", () => navigateActive("minova://history"));
  $("#openBookmarksButton")?.addEventListener("click", () => navigateActive("minova://bookmarks"));
  $("#refreshProtectedContentButton")?.addEventListener("click", async () => {
    state.protectedContent = await window.minova.getProtectedContentStatus(null);
    renderSettings("system");
  });
  $("#openVmpTestButton")?.addEventListener("click", () => openTab("https://castlabs.github.io/wv-vmp-lab/"));
  $("#signInGoogleButton")?.addEventListener("click", () => openTab("https://accounts.google.com/"));
  $("#openGooglePasswordsFromProfileButton")?.addEventListener("click", () => openTab("https://passwords.google.com/"));
  $("#replayMinovaTourButton")?.addEventListener("click", () => window.minova.openFirstRunTour());
}

function utilityNav(active) {
  const links = [
    ["minova://settings", "Settings"],
    ["minova://passwords", "Passwords"],
    ["minova://history", "History"],
    ["minova://downloads", "Downloads"],
    ["minova://bookmarks", "Bookmarks"],
    ["minova://extensions", "Extensions"]
  ];
  return `
    <aside class="settings-nav">
      <div class="settings-brand"><img src="../assets/logos/minova-browser.png" alt="" />Minova</div>
      ${links.map(([url, label]) => `<button class="${active === url ? "active" : ""}" data-internal-nav="${url}">${label}</button>`).join("")}
    </aside>
  `;
}

function renderPasswords() {
  settingsPage.innerHTML = `
    ${utilityNav("minova://passwords")}
    <div class="settings-content">
      <h2>Passwords and Autofill</h2>
      <section class="settings-section password-import">
        <h3>Google Password Manager</h3>
        <div class="password-actions">
          <button class="primary-action" id="importGooglePasswordsButton" type="button">Import Google CSV</button>
          <button class="secondary-action" id="resyncGooglePasswordsButton" type="button">Resync Google Passwords</button>
          <button class="secondary-action" id="exportGooglePasswordsButton" type="button">Export for Google</button>
          <button class="secondary-action" id="openGooglePasswordsButton" type="button">Open Google Password Manager</button>
        </div>
        <p class="vault-status">${state.settings.googlePasswordImportState === "awaiting-export"
          ? "Waiting for a Google Password Manager CSV download. Minova will verify and import it automatically."
          : state.settings["profile.custom_google_password_imported"]
            ? "Google passwords have been imported into Minova's Windows-encrypted vault."
            : "Minova protects its vault with Windows encryption. Google does not provide third-party browsers with direct password sync, so transfer uses a temporary CSV."}</p>
      </section>
      <section class="settings-section password-form">
        <label class="setting-row vertical"><span>Site</span><input id="passwordSite" type="text" placeholder="https://example.com" /></label>
        <label class="setting-row vertical"><span>Username</span><input id="passwordUsername" type="text" placeholder="name@example.com" /></label>
        <label class="setting-row vertical"><span>Password</span><input id="passwordValue" type="password" placeholder="Password" /></label>
        <button class="primary-action" id="savePasswordButton" type="button">Save password</button>
        <p class="inline-status" id="passwordManagerStatus" aria-live="polite"></p>
      </section>
      <section class="settings-section list-section">
        ${state.passwords.length ? state.passwords.map((entry) => `
          <div class="managed-row">
            <div>
              <strong>${escapeHtml(entry.site)}</strong>
              <span>${escapeHtml(entry.username)}${entry.source === "google" ? " - Google import" : ""}</span>
              <code>${entry.visible ? escapeHtml(entry.password) : "••••••••"}</code>
            </div>
            <button data-password-toggle="${escapeHtml(entry.id)}">${entry.visible ? "Hide" : "Show"}</button>
            <button data-password-delete="${escapeHtml(entry.id)}">Delete</button>
          </div>
        `).join("") : `<p>No saved passwords yet.</p>`}
      </section>
    </div>
  `;
  bindInternalNav();
  $("#savePasswordButton").addEventListener("click", async () => {
    const site = $("#passwordSite").value.trim();
    const username = $("#passwordUsername").value.trim();
    const password = $("#passwordValue").value;
    const status = $("#passwordManagerStatus");
    if (!site || !username || !password) {
      status.textContent = "Enter a site, username, and password.";
      status.classList.add("error");
      return;
    }
    try {
      state.passwords = await window.minova.savePassword({ site, username, password });
      renderPasswords();
    } catch (error) {
      status.textContent = error.message || "Minova could not encrypt that password.";
      status.classList.add("error");
    }
  });
  $("#importGooglePasswordsButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.minova.importGooglePasswords();
      if (!result) return;
      state.passwords = result.passwords;
      state.settings = await window.minova.getSettings();
      renderPasswords();
      const status = $("#passwordManagerStatus");
      status.textContent = `Imported ${result.imported} password${result.imported === 1 ? "" : "s"}.`;
    } catch (error) {
      const status = $("#passwordManagerStatus");
      status.textContent = error.message || "Minova could not import that Google password export.";
      status.classList.add("error");
    } finally {
      if (document.body.contains(button)) button.disabled = false;
    }
  });
  $("#openGooglePasswordsButton").addEventListener("click", () => {
    openTab("https://passwords.google.com/");
  });
  $("#resyncGooglePasswordsButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.minova.resyncGooglePasswords();
      if (!result) return;
      state.passwords = result.passwords;
      state.settings = await window.minova.getSettings();
      renderPasswords();
      showToast("Waiting for the new Google password export.", "success", 4200);
    } catch (error) {
      showToast(error.message || "Minova could not start Google password resync.", "error", 5000);
    } finally {
      if (document.body.contains(button)) button.disabled = false;
    }
  });
  $("#exportGooglePasswordsButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.minova.exportPasswordsForGoogle();
      if (!result) return;
      const status = $("#passwordManagerStatus");
      status.textContent = `Exported ${result.exported} password${result.exported === 1 ? "" : "s"}. Import the CSV into Google Password Manager, then delete it.`;
    } catch (error) {
      const status = $("#passwordManagerStatus");
      status.textContent = error.message || "Minova could not export those passwords.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  });
  settingsPage.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.passwords.find((item) => item.id === button.dataset.passwordToggle);
      if (!entry) return;
      entry.visible = !entry.visible;
      renderPasswords();
    });
  });
  settingsPage.querySelectorAll("[data-password-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const entry = state.passwords.find((item) => item.id === button.dataset.passwordDelete);
      if (!entry || !confirm(`Delete the saved password for ${entry.site}?`)) return;
      state.passwords = await window.minova.removePassword(entry.id);
      renderPasswords();
    });
  });
}

async function renderExtensions() {
  const requestedTabId = state.activeTabId;
  const extensions = await window.minova.listExtensions();
  if (state.activeTabId !== requestedTabId || getActiveTab()?.url !== "minova://extensions") return;
  state.extensions = extensions;
  renderPinnedExtensions();
  settingsPage.innerHTML = `
    ${utilityNav("minova://extensions")}
    <div class="settings-content">
      <h2>Extensions</h2>
      <section class="settings-section">
        <h3>Chrome Web Store</h3>
        <p>Open the store and use Add to Minova, or paste an extension URL or ID below.</p>
        <form class="extension-store-form" id="webStoreExtensionForm">
          <input id="webStoreExtensionInput" type="text" autocomplete="off" spellcheck="false" placeholder="Chrome Web Store URL or extension ID" />
          <button class="primary-action" type="submit">Install</button>
        </form>
        <button class="secondary-action" id="openWebStoreButton">Open Chrome Web Store</button>
      </section>
      <section class="settings-section list-section">
        <h3>Developer extensions</h3>
        <p>Load an unpacked extension from a folder containing manifest.json.</p>
        <button class="secondary-action" id="loadExtensionButton">Load unpacked</button>
      </section>
      <section class="settings-section list-section">
        ${state.extensions.length ? state.extensions.map((extension) => `
          <div class="managed-row">
            <div class="extension-summary">
              ${extensionIconMarkup(extension)}
              <div>
                <strong>${escapeHtml(extension.name || "Unnamed extension")}</strong>
                <span>Version ${escapeHtml(extension.version || "unknown")}${extension.hasPopup ? " - toolbar popup" : extension.hasOptionsPage ? " - options page" : ""}</span>
                <code>${escapeHtml(extension.path || extension.id)}</code>
              </div>
            </div>
            ${extension.hasAction ? `<button data-extension-pin="${escapeHtml(extension.id)}">${state.pinnedExtensions.includes(extension.id) ? "Unpin" : "Pin"}</button>` : `<span class="extension-no-action">Runs without a toolbar button</span>`}
            <button data-extension-remove="${escapeHtml(extension.id)}">Remove</button>
          </div>
        `).join("") : `<p>No extensions loaded.</p>`}
      </section>
    </div>
  `;
  bindInternalNav();
  $("#webStoreExtensionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#webStoreExtensionInput");
    const submitButton = event.currentTarget.querySelector("button[type=submit]");
    if (!input.value.trim()) return;
    submitButton.disabled = true;
    submitButton.textContent = "Installing...";
    try {
      await window.minova.installWebStoreExtension(input.value);
      await renderExtensions();
    } catch (error) {
      showToast(error.message || "Minova could not install that Web Store extension.", "error");
      submitButton.disabled = false;
      submitButton.textContent = "Install";
    }
  });
  $("#loadExtensionButton").addEventListener("click", async () => {
    try {
      await window.minova.loadUnpackedExtension();
      renderExtensions();
    } catch (error) {
      showToast(error.message || "Minova could not load that extension.", "error");
    }
  });
  $("#openWebStoreButton").addEventListener("click", () => openTab("https://chromewebstore.google.com/"));
  settingsPage.querySelectorAll("[data-extension-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      const extensionId = button.dataset.extensionPin;
      if (state.pinnedExtensions.includes(extensionId)) {
        state.pinnedExtensions = state.pinnedExtensions.filter((id) => id !== extensionId);
      } else {
        state.pinnedExtensions.push(extensionId);
      }
      persistPinnedExtensions();
      renderPinnedExtensions();
      renderExtensions();
    });
  });
  settingsPage.querySelectorAll("[data-extension-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await window.minova.removeExtension(button.dataset.extensionRemove);
      state.pinnedExtensions = state.pinnedExtensions.filter((id) => id !== button.dataset.extensionRemove);
      persistPinnedExtensions();
      state.extensions = await window.minova.listExtensions();
      renderPinnedExtensions();
      renderExtensions();
    });
  });
}

function renderHistory() {
  settingsPage.innerHTML = `
    ${utilityNav("minova://history")}
    <div class="settings-content">
      <h2>History</h2>
      <section class="settings-section list-section">
        ${state.history.length ? state.history.map((entry, index) => `
          <div class="managed-row">
            <div>
              <strong>${escapeHtml(entry.title || titleForUrl(entry.url))}</strong>
              <span>${escapeHtml(entry.url)}</span>
              <code>${new Date(entry.visitedAt).toLocaleString()}</code>
            </div>
            <button data-history-open="${index}">Open</button>
            <button data-history-delete="${index}">Delete</button>
          </div>
        `).join("") : `<p>No history yet.</p>`}
      </section>
      <button class="danger-action history-clear-action" id="clearHistoryButton" ${state.history.length ? "" : "disabled"}>Delete all history</button>
    </div>
  `;
  bindInternalNav();
  settingsPage.querySelectorAll("[data-history-open]").forEach((button) => {
    button.addEventListener("click", () => openTab(state.history[Number(button.dataset.historyOpen)].url));
  });
  settingsPage.querySelectorAll("[data-history-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.history.splice(Number(button.dataset.historyDelete), 1);
      persistHistory();
      renderHistory();
    });
  });
  $("#clearHistoryButton")?.addEventListener("click", () => {
    clearAllHistory();
  });
}

function renderDownloads() {
  settingsPage.innerHTML = `
    ${utilityNav("minova://downloads")}
    <div class="settings-content">
      <h2>Downloads</h2>
      <section class="settings-section list-section">
        ${state.downloads.length ? state.downloads.map((download, index) => `
          <div class="managed-row">
            <div>
              <strong>${escapeHtml(download.filename)}</strong>
              <span>${escapeHtml(download.state)}${download.totalBytes ? ` - ${Math.round((download.receivedBytes / download.totalBytes) * 100)}%` : ""}</span>
              <code>${escapeHtml(download.savePath || download.url || "")}</code>
            </div>
            <button data-download-open="${index}" ${download.state !== "completed" ? "disabled" : ""}>Open</button>
            <button data-download-delete="${index}">Delete</button>
          </div>
        `).join("") : `<p>No downloads yet.</p>`}
      </section>
      ${state.downloads.length ? `<button class="secondary-action" id="clearDownloadsButton">Clear downloads</button>` : ""}
    </div>
  `;
  bindInternalNav();
  settingsPage.querySelectorAll("[data-download-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const download = state.downloads[Number(button.dataset.downloadOpen)];
      if (download?.savePath) window.minova.openPath(download.savePath);
    });
  });
  settingsPage.querySelectorAll("[data-download-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.downloads.splice(Number(button.dataset.downloadDelete), 1);
      persistDownloads();
      renderDownloads();
    });
  });
  $("#clearDownloadsButton")?.addEventListener("click", () => {
    state.downloads = [];
    persistDownloads();
    renderDownloads();
  });
}

function renderBookmarks() {
  settingsPage.innerHTML = `
    ${utilityNav("minova://bookmarks")}
    <div class="settings-content">
      <h2>Bookmarks</h2>
      <section class="settings-section list-section">
        ${state.bookmarks.length ? state.bookmarks.map((url, index) => `
          <div class="managed-row">
            <div>
              <strong>${escapeHtml(titleForUrl(url))}</strong>
              <span>${escapeHtml(url)}</span>
            </div>
            <button data-bookmark-open="${index}">Open</button>
            <button data-bookmark-delete="${index}">Delete</button>
          </div>
        `).join("") : `<p>No bookmarks yet.</p>`}
      </section>
    </div>
  `;
  bindInternalNav();
  settingsPage.querySelectorAll("[data-bookmark-open]").forEach((button) => {
    button.addEventListener("click", () => openTab(state.bookmarks[Number(button.dataset.bookmarkOpen)]));
  });
  settingsPage.querySelectorAll("[data-bookmark-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.bookmarks.splice(Number(button.dataset.bookmarkDelete), 1);
      persistBookmarks();
      updateToolbar();
      renderBookmarks();
    });
  });
}

function bindInternalNav() {
  settingsPage.querySelectorAll("[data-internal-nav]").forEach((button) => {
    button.addEventListener("click", () => navigateActive(button.dataset.internalNav));
  });
}

function setZoom(delta) {
  const nextZoom = Math.min(1.5, Math.max(0.75, Number(state.settings.defaultZoom) + delta));
  state.settings.defaultZoom = Number(nextZoom.toFixed(2));
  window.minova.setSettings({ defaultZoom: state.settings.defaultZoom });
  window.minova.updateQuickMenuState({ zoom: state.settings.defaultZoom });
  const tab = getActiveTab();
  if (tab && !isInternalPage(tab.url)) {
    window.minova.setBrowserTabZoom(tab.id, state.settings.defaultZoom);
  }
}

function reloadActiveTab() {
  const tab = getActiveTab();
  if (!tab) return;
  if (isInternalPage(tab.url)) renderInternalPage();
  else window.minova.reloadBrowserTab(tab.id);
}

async function refreshActiveMediaStatus() {
  const tab = getActiveTab();
  const request = ++mediaStatusRequest;
  if (!tab || isInternalPage(tab.url)) {
    if (tab) {
      tab.hasMedia = false;
      tab.hasVideo = false;
      updateToolbar();
    }
    return;
  }
  try {
    const status = await window.minova.getBrowserTabMediaStatus(tab.id);
    if (request !== mediaStatusRequest || tab.id !== state.activeTabId) return;
    tab.hasMedia = Boolean(status.hasMedia);
    tab.hasVideo = Boolean(status.hasVideo);
    tab.volumeBoost = Number(status.boost) || 1;
    updateToolbar();
  } catch {
    // Navigating can replace the page while a media check is running.
  }
}

async function popoutActiveMedia() {
  const tab = getActiveTab();
  if (!tab || isInternalPage(tab.url)) return;

  try {
    await window.minova.requestBrowserTabPictureInPicture(tab.id);
  } catch (error) {
    showToast(error.message || "Minova could not open this video in Picture-in-Picture.", "error");
  }
}

async function openActiveInStreamingMode() {
  const tab = getActiveTab();
  const url = tab && !isInternalPage(tab.url) ? tab.url : "";
  if (getActiveWorkspace()?.splitTabIds.length === 2) {
    showToast("Exit Split View before entering Streaming Mode.", "error");
    return;
  }
  try {
    if (state.assistantOpen) await setAssistantOpen(false, { initialize: false, sync: true });
    return await window.minova.openStreamingMode(tab?.id || "", url);
  } catch (error) {
    showToast(error.message || "Minova could not open Streaming Mode.", "error");
    return null;
  }
}

async function exitStreamingMode() {
  try {
    await window.minova.exitStreamingMode();
  } catch (error) {
    showToast(error.message || "Minova could not close Streaming Mode.", "error");
  }
}

function applyStreamingModeState(nextState = {}) {
  const wasBackgrounded = Boolean(state.streamingMode.active && state.streamingMode.backgrounded);
  state.streamingMode = { ...state.streamingMode, ...nextState };
  const streamingForeground = (state.streamingMode.active || state.streamingMode.starting)
    && !state.streamingMode.backgrounded;
  if (streamingForeground && !findBar.classList.contains("hidden")) {
    closeFindBar();
  }
  if (streamingForeground && state.assistantOpen) {
    setAssistantOpen(false, { initialize: false, sync: true }).catch(() => {});
  }
  updateToolbar();
  if (!wasBackgrounded && state.streamingMode.active && state.streamingMode.backgrounded) {
    showToast("Streaming Mode paused in the background.", "success", 2200);
  }
}

function resumeStreamingMode() {
  const sourceTab = state.tabs.find((tab) => tab.id === state.streamingMode.sourceTabId);
  if (!sourceTab) {
    showToast("The Streaming Mode source tab is no longer available.", "error");
    exitStreamingMode();
    return;
  }
  activateTab(sourceTab.id);
}

function applyTheme() {
  if (!state.settings) return;
  const root = document.documentElement;
  const requestedTheme = state.settings.theme;
  const resolvedTheme = requestedTheme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : requestedTheme;
  root.dataset.theme = resolvedTheme;
  Object.values(THEME_CSS_VARIABLES).forEach((variable) => root.style.removeProperty(variable));
  root.style.removeProperty("color-scheme");
  if (resolvedTheme !== "custom") return;

  for (const [key, variable] of Object.entries(THEME_CSS_VARIABLES)) {
    const color = normalizeHexColor(state.settings.customThemeColors?.[key]);
    if (color) root.style.setProperty(variable, color);
  }
  const background = normalizeHexColor(state.settings.customThemeColors?.background) || "#111316";
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  root.style.setProperty("color-scheme", luminance > 0.55 ? "light" : "dark");
}

function getThemeSnapshot() {
  const styles = getComputedStyle(document.documentElement);
  return {
    colorScheme: styles.colorScheme.includes("light") ? "light" : "dark",
    colors: Object.fromEntries(
      Object.entries(THEME_CSS_VARIABLES).map(([key, variable]) => [key, styles.getPropertyValue(variable).trim()])
    )
  };
}

function updateMaximizeButton(maximized) {
  const button = $("#maximizeWindowButton");
  button.classList.toggle("restore", maximized);
  button.title = maximized ? "Restore" : "Maximize";
  button.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
}

$("#newTabButton").addEventListener("click", () => openTab("minova://newtab"));
$("#newPrivateTabButton").addEventListener("click", () => openTab("minova://newtab", { private: true }));
$("#splitViewButton").addEventListener("click", toggleSplitView);
$("#toggleSidebarButton").addEventListener("click", () => {
  if (!usesClassicTabLayout() && (state.streamingMode.active || state.streamingMode.starting)) {
    showToast("The workspace sidebar stays collapsed during Streaming Mode.");
    return;
  }
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarState();
  persistSession();
});
$("#newWorkspaceButton").addEventListener("click", () => openWorkspaceDialog());
$("#workspaceForm").addEventListener("submit", saveWorkspace);
$("#closeWorkspaceDialogButton").addEventListener("click", closeWorkspaceDialog);
$("#cancelWorkspaceButton").addEventListener("click", closeWorkspaceDialog);
$("#deleteWorkspaceButton").addEventListener("click", deleteWorkspace);
workspaceDialog.addEventListener("click", (event) => {
  if (event.target === workspaceDialog) closeWorkspaceDialog();
});
$("#minimizeWindowButton").addEventListener("click", () => window.minova.minimizeWindow());
$("#maximizeWindowButton").addEventListener("click", async () => {
  updateMaximizeButton(await window.minova.toggleMaximizeWindow());
});
$("#closeWindowButton").addEventListener("click", () => window.minova.closeWindow());
$("#settingsButton").addEventListener("click", () => openTab("minova://settings"));
$("#assistantButton").addEventListener("click", () => {
  setAssistantOpen(!state.assistantOpen).catch((error) => showToast(error.message, "error"));
});
$("#closeAssistantButton").addEventListener("click", () => {
  setAssistantOpen(false, { initialize: false }).catch(() => {});
});
$("#summarizePageButton").addEventListener("click", summarizeActivePageWithAssistant);
$("#newAssistantChatButton").addEventListener("click", () => {
  if (state.assistant.busy) return;
  assistantConversation.length = 0;
  activeAssistantRequestId = "";
  renderAssistantMessages();
  assistantInput.focus();
});
$("#assistantStopButton").addEventListener("click", async () => {
  if (activeAssistantRequestId) await window.minova.cancelAssistantRequest(activeAssistantRequestId);
});
$("#assistantForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendAssistantChatMessage(assistantInput.value);
});
assistantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#assistantForm").requestSubmit();
  }
});
$("#extensionsButton").addEventListener("click", () => {
  const tab = getActiveTab();
  const extensionId = getChromeWebStoreExtensionId(tab?.url || "");
  const installed = extensionId && state.extensions.some((extension) => extension.id === extensionId);
  if (extensionId && !installed) installCurrentWebStoreExtension();
  else openTab("minova://extensions");
});
installWebStoreExtensionButton.addEventListener("click", installCurrentWebStoreExtension);
$("#closeWebStoreInstallButton").addEventListener("click", () => {
  dismissedWebStoreExtensionId = webStoreInstallBar.dataset.extensionId || null;
  webStoreInstallBar.classList.add("hidden");
});
$("#mainMenuButton").addEventListener("click", async (event) => {
  event.stopPropagation();
  const historyItems = state.history.slice(0, 20).map((entry) => ({
    url: entry.url,
    title: entry.title || titleForUrl(entry.url),
    visitedAt: entry.visitedAt
  }));
  const bookmarkItems = state.bookmarks.slice(0, 20).map((url) => ({
    url,
    title: state.history.find((entry) => entry.url === url)?.title || titleForUrl(url)
  }));
  await window.minova.toggleQuickMenu({
    zoom: state.settings.defaultZoom,
    title: getActiveTab()?.title || "New tab",
    canReopenClosedTab: state.closedTabs.length > 0,
    history: historyItems,
    bookmarks: bookmarkItems,
    theme: getThemeSnapshot()
  });
});
async function handleQuickMenuAction(payload) {
  const action = typeof payload === "string" ? payload : payload?.action;
  if (action === "open-url" && payload?.url) {
    openTab(normalizeUrl(payload.url));
    return;
  }
  if (action === "zoom-out") {
    setZoom(-0.1);
    return;
  }
  if (action === "zoom-in") {
    setZoom(0.1);
    return;
  }
  if (action === "new-tab") openTab("minova://newtab");
  if (action === "new-private-tab") openTab("minova://newtab", { private: true });
  if (action === "reopen-closed-tab") reopenClosedTab();
  if (action === "passwords") openTab("minova://passwords");
  if (action === "history") openTab("minova://history");
  if (action === "downloads") openTab("minova://downloads");
  if (action === "bookmarks") openTab("minova://bookmarks");
  if (action === "extensions") openTab("minova://extensions");
  if (action === "streaming-mode") await openActiveInStreamingMode();
  if (action === "clear-data") {
    await window.minova.clearBrowsingData();
    clearAllHistory();
    showToast("Browsing data cleared.", "success");
  }
  if (action === "clear-history") clearAllHistory();
  if (action === "settings") openTab("minova://settings");
  if (action === "check-updates") await checkForUpdates();
  if (action === "help") openTab("minova://about");
  if (action === "report-bug") await window.minova.openFeedback("bug");
  if (action === "request-feature") await window.minova.openFeedback("feature");
  if (action === "print") {
    const tab = getActiveTab();
    if (tab && !isInternalPage(tab.url)) await window.minova.printBrowserTab(tab.id);
  }
  if (action === "find") openFindBar();
  if (action === "developer-tools") {
    const tab = getActiveTab();
    if (tab && !isInternalPage(tab.url)) await window.minova.openBrowserTabDevTools(tab.id);
  }
  if (action === "fullscreen") await window.minova.toggleFullscreenWindow();
  if (action === "exit") window.minova.closeWindow();
}
window.minova.onQuickMenuAction(handleQuickMenuAction);
document.addEventListener("click", (event) => {
  if (!$("#navigationForm").contains(event.target)) hideOmniboxSuggestions();
});
async function handleBrowserShortcut(key, shift = false) {
  if (key === "l") {
    omnibox.focus();
    omnibox.select();
  }
  if (key === "t") {
    if (shift) reopenClosedTab();
    else openTab("minova://newtab");
  }
  if (shift && key === "n") {
    openTab("minova://newtab", { private: true });
  }
  if (key === "w") {
    closeTab(state.activeTabId);
  }
  if (key === "r") {
    reloadActiveTab();
  }
  if (key === "h") {
    openTab("minova://history");
  }
  if (key === "j") {
    openTab("minova://downloads");
  }
  if (key === "f") {
    openFindBar();
  }
  if (key === "p") {
    const tab = getActiveTab();
    if (tab && !isInternalPage(tab.url)) await window.minova.printBrowserTab(tab.id);
  }
  if (shift && key === "i") {
    const tab = getActiveTab();
    if (tab && !isInternalPage(tab.url)) await window.minova.openBrowserTabDevTools(tab.id);
  }
  if (shift && key === "delete") {
    await window.minova.clearBrowsingData();
    clearAllHistory();
    showToast("Browsing data cleared.", "success");
  }
}
document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (!["l", "t", "w", "r", "h", "j", "f", "p"].includes(key) && !(event.shiftKey && ["n", "i", "delete"].includes(key))) return;
  event.preventDefault();
  handleBrowserShortcut(key, event.shiftKey);
});
$("#homeButton").addEventListener("click", () => navigateActive(state.settings.homeUrl));
$("#backButton").addEventListener("click", () => {
  if (state.streamingMode.active && !state.streamingMode.backgrounded) {
    window.minova.controlStreamingMode("back");
    return;
  }
  const tab = getActiveTab();
  if (tab?.canGoBack) window.minova.goBackBrowserTab(tab.id);
});
$("#forwardButton").addEventListener("click", () => {
  if (state.streamingMode.active && !state.streamingMode.backgrounded) {
    window.minova.controlStreamingMode("forward");
    return;
  }
  const tab = getActiveTab();
  if (tab?.canGoForward) window.minova.goForwardBrowserTab(tab.id);
});
$("#reloadButton").addEventListener("click", () => {
  if (state.streamingMode.active && !state.streamingMode.backgrounded) {
    window.minova.controlStreamingMode("reload");
    return;
  }
  reloadActiveTab();
});
$("#streamingModeButton").addEventListener("click", openActiveInStreamingMode);
$("#exitStreamingModeButton").addEventListener("click", exitStreamingMode);
$("#resumeStreamingModeButton").addEventListener("click", resumeStreamingMode);
$("#popoutButton").addEventListener("click", popoutActiveMedia);
function getVolumeMenuAnchor() {
  const bounds = $("#volumeButton").getBoundingClientRect();
  return {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
    width: bounds.width,
    height: bounds.height
  };
}

$("#volumeButton").addEventListener("click", () => {
  window.minova.toggleVolumeMenu(getVolumeMenuAnchor());
});

let volumeMenuAnchorFrame = 0;
window.addEventListener("resize", () => {
  window.cancelAnimationFrame(volumeMenuAnchorFrame);
  volumeMenuAnchorFrame = window.requestAnimationFrame(() => {
    window.minova.positionVolumeMenu(getVolumeMenuAnchor());
  });
});
findInput.addEventListener("input", () => {
  window.clearTimeout(findDebounce);
  findDebounce = window.setTimeout(() => runFind(true, false), 120);
});
findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runFind(!event.shiftKey, true);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeFindBar();
  }
});
$("#findPreviousButton").addEventListener("click", () => runFind(false, true));
$("#findNextButton").addEventListener("click", () => runFind(true, true));
$("#closeFindButton").addEventListener("click", closeFindBar);
$("#bookmarkButton").addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || isInternalPage(tab.url)) return;
  if (state.bookmarks.includes(tab.url)) {
    state.bookmarks = state.bookmarks.filter((url) => url !== tab.url);
  } else {
    state.bookmarks.push(tab.url);
  }
  persistBookmarks();
  updateToolbar();
});
$("#navigationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (selectedSuggestionIndex >= 0) {
    useSuggestion(selectedSuggestionIndex);
    return;
  }
  navigateActive(omnibox.value);
});
omnibox.addEventListener("input", renderOmniboxSuggestions);
omnibox.addEventListener("mousedown", () => {
  selectOmniboxOnMouseUp = document.activeElement !== omnibox;
});
omnibox.addEventListener("focus", () => {
  omnibox.select();
  if (omnibox.value.trim()) renderOmniboxSuggestions();
});
omnibox.addEventListener("mouseup", (event) => {
  if (!selectOmniboxOnMouseUp) return;
  event.preventDefault();
  selectOmniboxOnMouseUp = false;
  omnibox.select();
});
omnibox.addEventListener("blur", () => {
  selectOmniboxOnMouseUp = false;
  setTimeout(() => {
    if (document.activeElement !== omnibox) hideOmniboxSuggestions();
  }, 120);
});
omnibox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    if (!visibleSuggestions.length) renderOmniboxSuggestions();
    if (visibleSuggestions.length) {
      event.preventDefault();
      updateSuggestionSelection(selectedSuggestionIndex + 1);
    }
  }
  if (event.key === "ArrowUp" && visibleSuggestions.length) {
    event.preventDefault();
    updateSuggestionSelection(selectedSuggestionIndex - 1);
  }
  if (event.key === "Escape") hideOmniboxSuggestions();
});
window.minova.onOmniboxSuggestionSelected((index) => useSuggestion(Number(index)));
window.minova.onOmniboxSuggestionsDismissed(() => resetOmniboxSuggestions(false));
window.minova.onStreamingModeState(applyStreamingModeState);
window.minova.onAssistantState(applyAssistantState);
window.minova.onAssistantStream(({ requestId, delta } = {}) => {
  const pending = assistantConversation.find((message) => message.pending && message.requestId === requestId)
    || assistantConversation.find((message) => message.pending && !message.requestId);
  if (!pending) return;
  if (!pending.requestId) pending.requestId = requestId;
  pending.content += String(delta || "");
  activeAssistantRequestId = requestId;
  renderAssistantMessages();
});
window.minova.onAssistantDone(({ requestId } = {}) => {
  const pending = assistantConversation.find((message) => message.pending && message.requestId === requestId);
  if (pending) pending.pending = false;
  if (activeAssistantRequestId === requestId) activeAssistantRequestId = "";
  applyAssistantState({ busy: false, error: "" });
  renderAssistantMessages();
});
window.minova.onAssistantError(({ requestId, message } = {}) => {
  const pending = assistantConversation.find((entry) => entry.pending && entry.requestId === requestId)
    || assistantConversation.find((entry) => entry.pending);
  if (pending) {
    pending.pending = false;
    pending.error = true;
    pending.content = String(message || "Minova Assistant could not answer.");
  }
  if (activeAssistantRequestId === requestId) activeAssistantRequestId = "";
  applyAssistantState({ busy: false, error: String(message || "Local generation failed.") });
  renderAssistantMessages();
});
window.minova.onPrepareStreamingLayout(async ({ requestId } = {}) => {
  try {
    if (!usesClassicTabLayout() && !state.sidebarCollapsed) {
      state.sidebarCollapsed = true;
      applySidebarState({ sync: false });
      persistSession();
    }
    await syncBrowserLayout({ focus: false });
  } finally {
    window.minova.confirmStreamingLayout(requestId);
  }
});
window.addEventListener("resize", () => {
  if (visibleSuggestions.length) showNativeOmniboxSuggestions();
});
$("#newTabSearchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  navigateActive($("#newTabSearch").value);
});
quickLinks.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-shortcut-open]");
  if (openButton) {
    const shortcut = state.shortcuts.find((item) => item.id === openButton.dataset.shortcutOpen);
    if (shortcut) navigateActive(shortcut.url);
    return;
  }
  const editButton = event.target.closest("[data-shortcut-edit]");
  if (editButton) {
    openShortcutDialog(editButton.dataset.shortcutEdit);
    return;
  }
  if (event.target.closest("[data-shortcut-add]")) openShortcutDialog();
});
$("#shortcutForm").addEventListener("submit", saveShortcut);
$("#closeShortcutDialogButton").addEventListener("click", closeShortcutDialog);
$("#cancelShortcutButton").addEventListener("click", closeShortcutDialog);
$("#deleteShortcutButton").addEventListener("click", deleteShortcut);
shortcutDialog.addEventListener("click", (event) => {
  if (event.target === shortcutDialog) closeShortcutDialog();
});

window.minova.onNewTab((payload) => {
  if (payload && typeof payload === "object") {
    openTab(payload.url, { private: Boolean(payload.private) });
  } else {
    openTab(payload);
  }
});
window.minova.onBrowserTabState((nextState) => {
  const tab = state.tabs.find((item) => item.id === nextState.id);
  if (!tab || isInternalPage(tab.url)) return;
  if (nextState.url && /^(https?|chrome-extension):\/\//i.test(nextState.url)) tab.url = nextState.url;
  if (nextState.webContentsId) tab.nativeWebContentsId = nextState.webContentsId;
  if (nextState.title) tab.title = nextState.title;
  if (typeof nextState.loading === "boolean") tab.loading = nextState.loading;
  if (typeof nextState.canGoBack === "boolean") tab.canGoBack = nextState.canGoBack;
  if (typeof nextState.canGoForward === "boolean") tab.canGoForward = nextState.canGoForward;
  if (typeof nextState.pinned === "boolean") tab.pinned = nextState.pinned;
  if (typeof nextState.suspended === "boolean") {
    tab.suspended = nextState.suspended;
    tab.suspendedAt = Number(nextState.suspendedAt) || 0;
    if (state.tabPerformance) {
      state.tabPerformance.suspendedTabs = state.tabs.filter((entry) => entry.suspended).length;
    }
  }
  if (nextState.favicon) tab.favicon = nextState.favicon;
  if (nextState.loading || nextState.recovering || nextState.loadError === null) tab.loadError = null;
  if (nextState.loadError) tab.loadError = nextState.loadError.description || "This page could not be loaded.";
  if (nextState.loaded && tab.url) recordHistory(tab.url, tab.title, tab);
  if (nextState.crashed && tab.id === state.activeTabId) {
    showToast(tab.loadError || "This page stopped unexpectedly.", "error", 5000);
  }
  if ((nextState.loaded || nextState.mediaChanged) && tab.id === state.activeTabId) refreshActiveMediaStatus();
  renderTabs();
  if (tab.id === state.activeTabId) updateToolbar();
  persistSession();
});
  window.minova.onAdoptBrowserTab((details) => {
  if (state.tabs.some((tab) => tab.id === details.id)) return;
  const tab = {
    id: details.id,
    workspaceId: getWorkspace(details.workspaceId)?.id || state.activeWorkspaceId,
    url: details.url || "minova://newtab",
    title: details.title || titleForUrl(details.url || "minova://newtab"),
    private: false,
    pinned: false,
    suspended: false,
    suspendedAt: 0,
    loading: false,
    nativeReady: Promise.resolve({ webContentsId: details.webContentsId }),
    nativeWebContentsId: details.webContentsId || null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    favicon: "",
    hasMedia: false,
    hasVideo: false,
    volumeBoost: 1
  };
  state.tabs.push(tab);
  if (details.active) {
    state.activeWorkspaceId = tab.workspaceId;
    state.activeTabId = tab.id;
    const workspace = getWorkspace(tab.workspaceId);
    if (workspace) {
      workspace.activeTabId = tab.id;
      workspace.splitTabIds = [];
    }
    renderInternalPage();
    updateToolbar();
    syncBrowserLayout({ focus: true });
  }
  renderTabs();
  renderPinnedExtensions();
  refreshActiveMediaStatus();
  persistSession();
});
window.minova.onActivateBrowserTab((tabId) => {
  if (!state.tabs.some((tab) => tab.id === tabId)) return;
  activateTab(tabId);
});
window.minova.onRemoveBrowserTab((tabId) => {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  const removedTab = state.tabs[index];
  const wasActive = state.activeTabId === tabId;
  rememberClosedTab(removedTab);
  state.tabs.splice(index, 1);
  for (const workspace of state.workspaces) {
    workspace.splitTabIds = workspace.splitTabIds.filter((id) => id !== tabId);
    if (workspace.splitTabIds.length !== 2) workspace.splitTabIds = [];
    if (workspace.activeTabId === tabId) workspace.activeTabId = null;
  }
  if (!state.tabs.length) {
    openTab("minova://newtab");
    return;
  }
  if (wasActive) {
    const next = getWorkspaceTabs(removedTab.workspaceId)[0];
    if (next) activateTab(next.id);
    else openTab("minova://newtab", { workspaceId: removedTab.workspaceId });
  } else {
    syncBrowserLayout({ focus: false });
  }
  renderTabs();
  persistSession();
});
window.minova.onBrowserShortcut((shortcut) => {
  handleBrowserShortcut(shortcut.key, shortcut.shift);
});
window.minova.onFindResult((result) => {
  if (result?.tabId !== state.activeTabId || findBar.classList.contains("hidden")) return;
  findState.activeMatchOrdinal = Number(result.activeMatchOrdinal) || 0;
  findState.matches = Number(result.matches) || 0;
  updateFindResult();
});
window.minova.onExtensionInstalled((extension) => {
  state.extensions = [
    ...state.extensions.filter((item) => item.id !== extension.id),
    extension
  ];
  if (!state.pinnedExtensions.includes(extension.id)) state.pinnedExtensions.push(extension.id);
  persistPinnedExtensions();
  renderPinnedExtensions();
  updateWebStoreInstallBar(getActiveTab()?.url || "");
  if (getActiveTab()?.url === "minova://extensions") renderExtensions();
  showToast(`${extension.name || "Extension"} added to Minova.`, "success");
});
window.minova.onWindowMaximizedChanged(updateMaximizeButton);
window.minova.onSettingsChanged((settings) => {
  const previousLayout = state.settings?.tabLayout;
  state.settings = settings;
  applyTheme();
  if (previousLayout !== state.settings.tabLayout) {
    applyInterfaceLayout();
  }
  if (isInternalPage(getActiveTab()?.url || "")) renderInternalPage();
});
window.minova.onPasswordsChanged(async (passwords) => {
  state.passwords = Array.isArray(passwords) ? passwords : [];
  state.settings = await window.minova.getSettings();
  if (getActiveTab()?.url === "minova://passwords") renderPasswords();
  showToast("Google passwords were imported into the encrypted vault.", "success", 4800);
});
window.minova.onPasswordImportError((message) => {
  showToast(message || "Minova could not import that Google password export.", "error", 5200);
});
window.minova.onDownloadUpdate((download) => {
  const index = state.downloads.findIndex((item) => item.id === download.id);
  const previousState = index === -1 ? "" : state.downloads[index].state;
  if (index === -1) {
    state.downloads.unshift(download);
  } else {
    state.downloads[index] = { ...state.downloads[index], ...download };
  }
  persistDownloads();
  if (download.state === "completed" && previousState !== "completed") {
    showToast(`${download.filename || "Download"} is ready.`, "success");
  }
  if (download.state === "interrupted" && previousState !== "interrupted") {
    showToast(`${download.filename || "Download"} could not finish.`, "error");
  }
  if (getActiveTab()?.url === "minova://downloads") renderDownloads();
});

async function boot() {
  state.settings = await window.minova.getSettings();
  state.tabPerformance = await window.minova.getTabPerformanceStatus();
  state.version = await window.minova.getVersion();
  state.updater = await window.minova.getUpdateState();
  state.streamingMode = { ...state.streamingMode, ...(await window.minova.getStreamingModeState()) };
  state.assistant = { ...state.assistant, ...(await window.minova.getAssistantState()) };
  state.protectedContent = state.version.protectedContent;
  state.extensions = await window.minova.listExtensions();
  renderPinnedExtensions();
  try {
    state.passwords = await window.minova.listPasswords();
    if (legacyPasswords.length) {
      state.passwords = await window.minova.migrateLegacyPasswords(legacyPasswords);
      localStorage.removeItem("minova:passwords");
    }
  } catch (error) {
    console.error("Minova could not open the encrypted password vault:", error);
    state.passwords = [];
  }
  applyTheme();
  renderAssistantMessages();
  applyAssistantState(state.assistant);
  applyInterfaceLayout({ sync: false });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });
  updateMaximizeButton(await window.minova.isWindowMaximized());
  renderShortcuts();
  persistClosedTabs();

  const restoredTabs = state.settings.startupMode === "continue"
    ? (Array.isArray(savedSession.tabs) ? savedSession.tabs : [])
      .filter((tab) => isRestorableTabUrl(tab?.url))
      .slice(0, 50)
    : [];
  const startupTabs = restoredTabs.length
    ? restoredTabs
    : [{
      url: state.settings.startupMode === "newtab"
        ? "minova://newtab"
        : state.settings.startupUrl || "minova://newtab"
    }];

  const openedTabs = startupTabs.map((entry) => {
    const workspaceId = getWorkspace(entry.workspaceId)?.id || state.activeWorkspaceId;
    const tab = openTab(entry.url, {
      activate: false,
      pinned: Boolean(entry.pinned),
      workspaceId
    });
    if (entry.title) tab.title = String(entry.title);
    return tab;
  });
  const activeIndex = restoredTabs.length
    ? Math.min(openedTabs.length - 1, Math.max(0, Number(savedSession.activeIndex) || 0))
    : 0;

  const savedWorkspaceState = new Map(
    (Array.isArray(savedSession.workspaces) ? savedSession.workspaces : [])
      .map((workspace) => [String(workspace?.id || ""), workspace])
  );
  for (const workspace of state.workspaces) {
    const savedWorkspace = savedWorkspaceState.get(workspace.id);
    const activeTabIndex = Number(savedWorkspace?.activeTabIndex);
    workspace.activeTabId = Number.isInteger(activeTabIndex)
      ? openedTabs[activeTabIndex]?.id || null
      : null;
    workspace.splitTabIds = (Array.isArray(savedWorkspace?.splitTabIndices)
      ? savedWorkspace.splitTabIndices
      : [])
      .map((index) => openedTabs[Number(index)]?.id)
      .filter(Boolean)
      .slice(0, 2);
    sanitizeWorkspaceLayout(workspace);
  }

  const restoredActiveWorkspace = getWorkspace(savedSession.activeWorkspaceId);
  const indexTab = openedTabs[activeIndex];
  state.activeWorkspaceId = restoredActiveWorkspace?.id || indexTab?.workspaceId || "personal";
  const activeWorkspace = getActiveWorkspace();
  const activeTab = state.tabs.find((tab) => tab.id === activeWorkspace?.activeTabId)
    || (indexTab?.workspaceId === activeWorkspace?.id ? indexTab : null)
    || getWorkspaceTabs(activeWorkspace?.id)[0]
    || openedTabs[0];
  activateTab(activeTab.id);
  renderTabs();
  setInterval(refreshActiveMediaStatus, 1500);
}

window.addEventListener("beforeunload", persistSession);

boot();
