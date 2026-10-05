"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readGooglePasswordCsv } = require("../src/password-import");
const {
  exclusionMatches,
  normalizeExclusions,
  normalizeTimeoutMinutes
} = require("../src/tab-performance-policy");
const {
  DEFAULT_CUSTOM_THEME_COLORS,
  normalizeCustomThemeColors,
  normalizeHexColor
} = require("../src/theme-settings");
const { TabWorkspaceManager } = require("../src/tab-workspace-manager");
const { calculateViewBounds } = require("../src/view-layout");
const { calculateStreamingLayout } = require("../src/streaming-layout");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

const csv = [
  "name,url,username,password,note",
  '"Example, Inc.",https://login.example.com,user@example.com,"p,ass""word","quoted note"',
  "Incomplete,https://empty.example.com,,,"
].join("\r\n");
const credentials = readGooglePasswordCsv(csv);
assert.equal(credentials.length, 1);
assert.equal(credentials[0].site, "https://login.example.com");
assert.equal(credentials[0].username, "user@example.com");
assert.equal(credentials[0].password, 'p,ass"word');
assert.equal(credentials[0].source, "google");
assert.throws(
  () => readGooglePasswordCsv("site,user,secret\nexample.com,a,b"),
  /not a Google Password Manager CSV export/i
);

assert.deepEqual(calculateViewBounds({
  windowWidth: 1320,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 272,
  paneCount: 1
}), { x: 272, y: 102, width: 1048, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1321,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 272,
  paneIndex: 0,
  paneCount: 2,
  gap: 2
}), { x: 272, y: 102, width: 523, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1321,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 272,
  paneIndex: 1,
  paneCount: 2,
  gap: 2
}), { x: 797, y: 102, width: 524, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 900,
  windowHeight: 640,
  chromeHeight: 102,
  sidebarWidth: 60,
  paneCount: 1
}), { x: 60, y: 102, width: 840, height: 538 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1320,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 0,
  paneCount: 1
}), { x: 0, y: 102, width: 1320, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1320,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 272,
  rightInset: 390,
  paneCount: 1
}), { x: 272, y: 102, width: 658, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1321,
  windowHeight: 860,
  chromeHeight: 102,
  sidebarWidth: 60,
  rightInset: 390,
  paneIndex: 1,
  paneCount: 2,
  gap: 2
}), { x: 496, y: 102, width: 435, height: 758 });
assert.deepEqual(calculateViewBounds({
  windowWidth: 1920,
  windowHeight: 1080,
  chromeHeight: 102,
  sidebarWidth: 272,
  paneCount: 2,
  fullscreen: true
}), { x: 0, y: 0, width: 1920, height: 1080 });

assert.deepEqual(calculateStreamingLayout({
  windowWidth: 1320,
  windowHeight: 860,
  chromeHeight: 102,
  toolbarHeight: 60,
  sidebarWidth: 60
}), {
  page: { x: 60, y: 102, width: 1260, height: 758 },
  toolbar: { x: 60, y: 42, width: 1260, height: 60 },
  capture: { x: 60, y: 42, width: 1260, height: 60 }
});
assert.deepEqual(calculateStreamingLayout({
  windowWidth: 1320,
  windowHeight: 860,
  chromeHeight: 102,
  toolbarHeight: 60,
  sidebarWidth: 0
}), {
  page: { x: 0, y: 102, width: 1320, height: 758 },
  toolbar: { x: 0, y: 42, width: 1320, height: 60 },
  capture: { x: 0, y: 42, width: 1320, height: 60 }
});

assert.equal(normalizeTimeoutMinutes("5"), 5);
assert.equal(normalizeTimeoutMinutes(0), 1);
assert.equal(normalizeTimeoutMinutes(99999), 1440);
assert.equal(normalizeTimeoutMinutes("invalid"), 30);
assert.deepEqual(normalizeExclusions([" example.com ", "", null]), ["example.com"]);
assert.equal(exclusionMatches("https://accounts.example.com/login", ["example.com"]), true);
assert.equal(exclusionMatches("https://notexample.com/", ["example.com"]), false);
assert.equal(normalizeHexColor("#AbC", "#000000"), "#aabbcc");
assert.equal(normalizeHexColor("not-a-color", "#123456"), "#123456");
assert.deepEqual(
  normalizeCustomThemeColors({ accent: "#ABC", background: "invalid" }),
  { ...DEFAULT_CUSTOM_THEME_COLORS, accent: "#aabbcc" }
);

let managerClock = 1000;
const workspaceManager = new TabWorkspaceManager({
  defaultWorkspaceId: "work",
  defaultWorkspaceName: "Work",
  maxVisibleTabs: 2,
  clock: () => ++managerClock
});
workspaceManager.createWorkspace({
  id: "gaming",
  name: "Gaming",
  color: "#14b8a6",
  sessionPartition: "persist:minova-workspace-gaming"
});
const workMailView = { name: "work-mail-view" };
const workDocsView = { name: "work-docs-view" };
const gamingView = { name: "gaming-view" };
workspaceManager.registerTab({
  id: "work-mail",
  view: workMailView,
  workspaceId: "work",
  metadata: { title: "Mail", url: "https://mail.example.test" }
});
workspaceManager.registerTab({
  id: "work-docs",
  view: workDocsView,
  workspaceId: "work",
  activate: false,
  metadata: { title: "Docs", url: "https://docs.example.test" }
});
workspaceManager.registerTab({
  id: "gaming-guide",
  view: gamingView,
  workspaceId: "gaming",
  metadata: { title: "Game Guide", url: "https://gaming.example.test" }
});
workspaceManager.setActiveTabs("work", ["work-mail", "work-docs"]);
assert.deepEqual(workspaceManager.getVisibleTabIds(), ["work-mail", "work-docs"]);
assert.deepEqual(
  workspaceManager.getVisibilityPlan()
    .filter((entry) => entry.visible)
    .map((entry) => [entry.tabId, entry.paneIndex]),
  [["work-mail", 0], ["work-docs", 1]]
);
workspaceManager.setActiveWorkspace("gaming");
assert.deepEqual(workspaceManager.getVisibleTabIds(), ["gaming-guide"]);
workspaceManager.setActiveWorkspace("work");
assert.deepEqual(workspaceManager.getVisibleTabIds(), ["work-mail", "work-docs"]);
workspaceManager.unregisterTab("work-docs");
assert.deepEqual(workspaceManager.getVisibleTabIds(), ["work-mail"]);
const workspaceSnapshot = workspaceManager.snapshot();
assert.equal(workspaceSnapshot.activeWorkspaceId, "work");
assert.deepEqual(workspaceSnapshot.visibleTabIds, ["work-mail"]);
assert.equal(workspaceSnapshot.tabs.some((tab) => Object.hasOwn(tab, "view")), false);
assert.equal(
  workspaceSnapshot.workspaces.find((workspace) => workspace.id === "gaming").sessionPartition,
  "persist:minova-workspace-gaming"
);
assert.throws(
  () => workspaceManager.setActiveTabs("work", ["work-mail", "gaming-guide"]),
  /does not belong to workspace/
);

const mainSource = source("src/main.js");
const rendererSource = source("src/renderer.js");
const preloadSource = source("src/preload.js");
const indexSource = source("src/index.html");
const stylesSource = source("src/styles.css");
const assistantStyles = source("src/assistant.css");
const assistantHost = source("src/assistant/engine-host.entry.js");
const assistantWorker = source("src/assistant/engine-worker.entry.js");
const assistantEnginePreload = source("src/assistant-engine-preload.js");
const volumeMenuHtml = source("src/volume-menu.html");
const volumeMenuSource = source("src/volume-menu.js");
const volumeMenuPreload = source("src/volume-menu-preload.js");
const workspaceEditorHtml = source("src/workspace-editor.html");
const workspaceEditorPreload = source("src/workspace-editor-preload.js");
const onboardingHtml = source("src/onboarding.html");
const onboardingCss = source("src/onboarding.css");
const onboardingSource = source("src/onboarding.js");
const onboardingPreload = source("src/onboarding-preload.js");
const streamingOverlaySource = source("src/streaming-overlay.ps1");
const quickMenu = source("src/quick-menu.html");
const feedbackService = source("server/feedback-service.mjs");
const releaseBuilder = source("scripts/build-updater-release.ps1");
const releaseNotes103 = source("release-notes/1.0.3.md");
const siteHome = source("website/index.html");
const siteFeatures = source("website/features.html");
const siteReleases = source("website/releases.html");
const siteConfig = source("website/assets/site-config.js");
assert.match(mainSource, /"profile\.custom_google_password_imported": false/);
assert.match(mainSource, /safeStorage\.encryptString/);
assert.match(mainSource, /if \(!MINOVA_USER_DATA_OVERRIDE\) migrateMinovaOwnedData\(\)/);
assert.match(mainSource, /ipcMain\.on\("window:control"/);
assert.match(mainSource, /executeShellWindowControl/);
assert.match(preloadSource, /WINDOW_CONTROL_ACTIONS/);
assert.match(preloadSource, /data\.nativeWindowControl|dataset\.nativeWindowControl/);
assert.match(stylesSource, /\.window-controls \*/);
assert.match(stylesSource, /\.app-shell\.classic-ui \.sidebar::after/);
assert.match(indexSource, /styles\.css\?v=minova-liquid-glass-2/);
assert.match(mainSource, /Page\.setWebLifecycleState/);
assert.doesNotMatch(mainSource, /Memory\.forciblyPurgeJavaScriptMemory/);
assert.match(mainSource, /tabSuspensionCustomUnit: "minutes"/);
assert.match(mainSource, /require\("electron-updater"\)/);
assert.match(mainSource, /autoUpdater\.autoDownload = true/);
assert.match(mainSource, /autoUpdater\.autoInstallOnAppQuit = true/);
assert.match(mainSource, /autoUpdater\.checkForUpdatesAndNotify\(\)/);
assert.match(mainSource, /ipcMain\.handle\("updates:check"/);
assert.match(mainSource, /normalizeCustomThemeColors/);
assert.match(mainSource, /UPDATE_LOG_FILENAME = "updater\.log"/);
assert.match(mainSource, /autoUpdater\.on\("update-downloaded"/);
assert.match(mainSource, /dialog\.showMessageBox/);
assert.match(mainSource, /buttons: \["Update Now", "Remind Me Later"\]/);
assert.match(mainSource, /formatUpdateReleaseNotes\(info\.releaseNotes\)/);
assert.match(mainSource, /if \(response === 0\)/);
assert.match(mainSource, /autoUpdater\.quitAndInstall\(true, true\)/);
assert.match(mainSource, /update-window\.html/);
assert.match(mainSource, /update-preload\.js/);
assert(fs.existsSync(path.join(root, "src", "update-window.html")));
assert(fs.existsSync(path.join(root, "installer", "MinovaBootstrapper.cs")));
assert.match(mainSource, /if \(response === 1\)/);
assert.match(mainSource, /Update deferred until Minova exits/);
assert.match(mainSource, /if \(updateInstallationRequested\) return/);
assert.match(mainSource, /sourceTabId: ownerTabId/);
assert.match(mainSource, /ownsStreamingOverlay/);
assert.match(mainSource, /stopStreamingOverlay\(\)\.catch/);
assert.match(mainSource, /openStreamingOverlay\(target\.url, target\.tabId\)/);
assert.match(mainSource, /openStreamingOverlay\(pageUrl, sourceTabId\)/);
assert.doesNotMatch(mainSource, /passwords\.txt/i);
assert.match(rendererSource, /openStreamingMode\(tab\?\.id \|\| "", url\)/);
assert.match(rendererSource, /tabSuspensionCustomUnit: unit/);
assert.match(rendererSource, /Math\.round\(value \* 60\)/);
assert.match(rendererSource, /data-theme-color=/);
assert.match(rendererSource, /getThemeSnapshot/);
assert.match(mainSource, /new TabWorkspaceManager/);
assert.match(mainSource, /ipcMain\.handle\("browser:workspace-layout"/);
assert.match(mainSource, /ipcMain\.handle\("browser:workspace-state"/);
assert.match(mainSource, /ipcMain\.handle\("workspace:editor-open"/);
assert.match(mainSource, /prepareStreamingLayout/);
assert.match(mainSource, /browser:streaming-layout-ready/);
assert.match(mainSource, /getStreamingToolbarCaptureRect/);
assert.match(mainSource, /calculateStreamingLayout/);
assert.match(mainSource, /modal: true/);
assert.match(mainSource, /tabLayout: "workspaces"/);
assert.match(mainSource, /FIRST_RUN_TOUR_VERSION = 1/);
assert.match(mainSource, /firstRunTourVersion: 0/);
assert.match(mainSource, /openFirstRunTour/);
assert.match(mainSource, /ipcMain\.handle\("onboarding:choose-layout"/);
assert.match(mainSource, /ipcMain\.handle\("onboarding:finish"/);
assert.match(mainSource, /dismissFirstRunTour/);
assert.match(mainSource, /if \(Number\.isFinite\(numericValue\) && numericValue === 0\) return 0/);
assert.match(mainSource, /Exit Split View before entering Streaming Mode/);
assert.match(mainSource, /SPLIT_VIEW_GAP/);
assert.match(mainSource, /paneIndexByTabId/);
assert.match(mainSource, /contents\.on\("focus"/);
assert.match(preloadSource, /setBrowserWorkspaceLayout/);
assert.match(preloadSource, /getBrowserWorkspaceState/);
assert.match(preloadSource, /openWorkspaceEditor/);
assert.match(preloadSource, /onPrepareStreamingLayout/);
assert.match(preloadSource, /confirmStreamingLayout/);
assert.match(preloadSource, /openFirstRunTour/);
assert.match(preloadSource, /onSettingsChanged/);
assert.match(mainSource, /ASSISTANT_PARTITION = "persist:minova-assistant"/);
assert.match(mainSource, /ipcMain\.handle\("assistant:chat"/);
assert.match(mainSource, /ipcMain\.handle\("assistant:summarize"/);
assert.match(mainSource, /ipcMain\.handle\("assistant:chat-with-page"/);
assert.match(mainSource, /ipcMain\.handle\("assistant:page-action"/);
assert.match(mainSource, /ASSISTANT_PAGE_ACTIONS = Object\.freeze/);
assert.match(mainSource, /ASSISTANT_MAX_PAGE_CHARACTERS = 8000/);
assert.match(mainSource, /ASSISTANT_MAX_PAGE_CHAT_HISTORY_CHARACTERS = 3200/);
assert.match(mainSource, /"explain-selection"/);
assert.match(mainSource, /"study-guide"/);
assert.match(mainSource, /"analyze-claims"/);
assert.match(mainSource, /"compare-tabs"/);
assert.match(mainSource, /readAssistantSplitPages/);
assert.match(mainSource, /clipboard\.writeText/);
assert.match(mainSource, /EXTRACT_ACTIVE_PAGE_TEXT/);
assert.match(mainSource, /rightInset: browserAssistantWidth/);
assert.match(preloadSource, /initializeAssistant/);
assert.match(preloadSource, /sendAssistantPageMessage/);
assert.match(preloadSource, /runAssistantPageAction/);
assert.match(preloadSource, /onAssistantStream/);
assert.match(preloadSource, /openHelp/);
assert.match(mainSource, /ipcMain\.handle\("help:open"/);
assert.match(indexSource, /id="assistantSidebar"/);
assert.match(indexSource, /id="summarizePageButton"/);
assert.match(indexSource, /id="assistantPageContextButton"/);
assert.match(indexSource, /data-assistant-page-action="rewrite-selection"/);
assert.match(indexSource, /data-assistant-page-action="study-guide"/);
assert.match(indexSource, /data-assistant-page-action="compare-tabs"/);
assert.match(indexSource, /id="assistantHelpButton"/);
assert.match(rendererSource, /persistAssistantConversation/);
assert.match(rendererSource, /ASSISTANT_PAGE_CONTEXT_KEY/);
assert.match(stylesSource, /--assistant-width/);
assert.match(assistantStyles, /\.assistant-sidebar/);
assert.match(assistantHost, /cacheBackend: "indexeddb"/);
assert.match(assistantHost, /Llama-3\.2-1B-Instruct-q4f16_1-MLC/);
assert.match(assistantHost, /CreateWebWorkerMLCEngine/);
assert.match(assistantHost, /RETRY_PROMPT_BUDGETS/);
assert.match(assistantHost, /compactMessagesForContextWindow/);
assert.match(assistantHost, /ContextWindowSizeExceeded/);
assert.match(assistantWorker, /WebWorkerMLCEngineHandler/);
assert.match(assistantEnginePreload, /contextBridge\.exposeInMainWorld/);
assert.match(volumeMenuHtml, /id="helpButton"/);
assert.match(volumeMenuSource, /minovaVolume\.openHelp/);
assert.match(volumeMenuPreload, /help:open/);
assert.match(onboardingPreload, /onboarding:get-state/);
assert.match(onboardingPreload, /onboarding:choose-layout/);
assert.match(onboardingPreload, /onboarding:finish/);
assert.match(onboardingHtml, /id="skipTourButton"/);
assert.match(onboardingHtml, /id="tourProgress"/);
assert.match(onboardingSource, /data-layout="workspaces"/);
assert.match(onboardingSource, /data-layout="classic"/);
assert.match(onboardingSource, /data-password-action="google"/);
assert.match(onboardingSource, /data-password-action="csv"/);
assert.match(onboardingSource, /data-password-action="later"/);
assert.match(onboardingSource, /skipButton\.addEventListener\("click", \(\) => goToStep\(steps\.length - 1\)\)/);
assert.match(onboardingCss, /\.layout-choice-grid/);
assert.match(onboardingCss, /\.password-layout/);
assert.match(workspaceEditorPreload, /workspace-editor:finish/);
assert.match(workspaceEditorHtml, /id="workspaceName"/);
assert.match(rendererSource, /function switchWorkspace/);
assert.match(rendererSource, /function toggleSplitView/);
assert.match(rendererSource, /function applyInterfaceLayout/);
assert.match(rendererSource, /state\.settings\?\.tabLayout === "classic"/);
assert.match(rendererSource, /state\.settings\?\.tabLayout === "safari"/);
assert.match(rendererSource, /function usesHorizontalTabLayout/);
assert.match(rendererSource, /CLASSIC_CHROME_HEIGHT/);
assert.match(rendererSource, /SAFARI_CHROME_HEIGHT/);
assert.match(rendererSource, /SAFARI_TOOLBAR_CAPTURE_HEIGHT/);
assert.match(rendererSource, /className = "workspace-edit-button"/);
assert.match(rendererSource, /Workspace sidebar/);
assert.match(rendererSource, /Classic horizontal tabs/);
assert.match(rendererSource, /Safari-style interface/);
assert.match(rendererSource, /onPrepareStreamingLayout/);
assert.match(rendererSource, /state\.sidebarCollapsed = true/);
assert.match(rendererSource, /sidebar stays collapsed during Streaming Mode/);
assert.match(indexSource, /id="workspaceList"/);
assert.match(indexSource, /id="splitViewButton"/);
assert.match(stylesSource, /grid-template-areas:[\s\S]*"sidebar toolbar"/);
assert.match(stylesSource, /\.vertical-tab-list/);
assert.match(stylesSource, /\.app-shell\.classic-ui/);
assert.match(stylesSource, /\.app-shell\.safari-ui/);
assert.match(stylesSource, /\.app-shell\.safari-ui \.window-control\.close span \{ background: #ff5f57; \}/);
assert.match(stylesSource, /\.app-shell\.safari-ui \.omnibox-wrap/);
assert.match(stylesSource, /:root\[data-theme="light"\] \.app-shell\.safari-ui/);
assert.match(mainSource, /browserToolbarHeight = normalizeBrowserToolbarHeight/);
assert.match(streamingOverlaySource, /\$command\.toolbarHeight/);
assert.match(stylesSource, /grid-template-rows:\s*42px 60px minmax\(0, 1fr\)/);
assert.match(stylesSource, /\.app-shell\.classic-ui \.titlebar\s*\{[\s\S]*position:\s*absolute/);
assert.match(stylesSource, /\.workspace-edit-button/);
assert.match(streamingOverlaySource, /\[int\]\$SidebarWidthDip/);
assert.match(streamingOverlaySource, /\$origin\.X \+ \$sidebarPixels/);
assert.match(streamingOverlaySource, /ToolbarLeft = \$origin\.X \+ \$sidebarPixels/);
assert.match(streamingOverlaySource, /\$command\.action -eq "layout"/);
assert.match(streamingOverlaySource, /\$command\.action -eq "suspend"/);
assert.match(streamingOverlaySource, /47 -shl 16/);
assert.match(streamingOverlaySource, /\$command\.action -eq "resume"/);
assert.match(streamingOverlaySource, /\$clientOrigin\.X - \$windowRect\.Left/);
assert.match(mainSource, /action: "layout"/);
assert.match(mainSource, /setStreamingOverlayBackgrounded/);
assert.match(indexSource, /id="resumeStreamingModeButton"/);
assert.match(quickMenu, /data-action="report-bug"/);
assert.match(quickMenu, /data-action="request-feature"/);
assert.match(quickMenu, /data-action="check-updates"/);
assert.match(feedbackService, /minova\.chromium@gmail\.com/);
assert.match(feedbackService, /MINOVA_FEEDBACK_TRUST_PROXY/);
assert.doesNotMatch(feedbackService, /RESEND_API_KEY\s*=\s*["'][^"']+["']/);
assert.match(releaseBuilder, /release-notes\\\$version\.md/);
assert.match(releaseBuilder, /body = \$releaseNotes/);
assert.match(releaseBuilder, /previously saved GitHub credential is no longer readable/);
assert.match(releaseBuilder, /Minova-Chromium-Source-\$version\.zip/);
assert.match(releaseBuilder, /Creating the GPL-3\.0 source archive/);
assert.match(releaseNotes103, /Workspace UI/);
assert.match(releaseNotes103, /Visual first-launch tour/);
assert.match(siteHome, /id="version-1-0-3"/);
assert.match(siteHome, /minova-workspaces\.png/);
assert.match(siteHome, /minova-first-run\.png/);
assert.match(siteFeatures, /id="interface"/);
assert.match(siteFeatures, /id="assistant"/);
assert.match(siteFeatures, /id="audio-studio"/);
assert.match(siteFeatures, /Split View comparison/);
assert.match(siteFeatures, /Split View/);
assert.match(siteReleases, /Minova Chromium 1\.0\.3/);
const configuredSiteVersion = siteConfig.match(/currentVersion: "(\d+\.\d+\.\d+)"/)?.[1];
assert.ok(configuredSiteVersion, "The website config must expose a semantic currentVersion.");
assert.match(
  siteConfig,
  new RegExp(`latestInstallerUrl: ".*Minova-Chromium-Setup-${configuredSiteVersion.replaceAll(".", "\\.")}\\.exe"`)
);

console.log(JSON.stringify({
  passed: true,
  csvEntries: credentials.length,
  timeoutBounds: [normalizeTimeoutMinutes(0), normalizeTimeoutMinutes(99999)],
  feedbackMenu: true,
  encryptedVault: true,
  tabLifecycle: true,
  streamingTabOwnership: true,
  manualUpdates: true,
  customThemes: true,
  multiViewWorkspaces: true,
  nativeWorkspaceEditor: true,
  splitStreamingGuard: true,
  classicAndWorkspaceLayouts: true,
  customizableDefaultWorkspaces: true,
  streamingLayoutHandshake: true,
  classicStreamingGeometry: true,
  streamingSidebarCollapseLock: true,
  firstRunOnboarding: true,
  versionedReleaseNotes: true,
  credentialFallback: true,
  gplSourceArchive: true,
  website103: true,
  localWebLlmAssistant: true,
  localAssistantPageTools: true,
  advancedLocalAssistantTools: true,
  assistantAndAudioHelp: true
}, null, 2));
