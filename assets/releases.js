"use strict";

const releaseConfig = window.MINOVA_SITE_CONFIG || {};
const releaseDownloadLinks = Array.from(document.querySelectorAll("[data-download-link]"));
const releaseList = document.querySelector("[data-release-list]");
const releaseStatus = document.querySelector("[data-release-status]");
const fallbackVersion = releaseConfig.currentVersion || "1.0.2";
const fallbackInstallerUrl = releaseConfig.latestInstallerUrl
  || "https://github.com/minova-chromium/Minova-Chromium/releases/download/v1.0.2/Minova-Chromium-Setup-1.0.2.exe";
const releasesApiUrl = releaseConfig.releasesApiUrl
  || "https://api.github.com/repos/minova-chromium/Minova-Chromium/releases?per_page=20";
const releaseCacheKey = "minova-public-releases-v1";

function setInstallerUrl(url) {
  releaseDownloadLinks.forEach((link) => {
    link.href = url;
    link.setAttribute("data-installer-ready", "true");
  });
}

function versionFromRelease(release) {
  return String(release?.tag_name || release?.name || fallbackVersion).trim().replace(/^v/i, "");
}

function findInstaller(release) {
  if (!Array.isArray(release?.assets)) return null;
  return release.assets.find((asset) => (
    /^Minova-Chromium-Setup-.*\.exe$/i.test(String(asset.name || ""))
    && asset.browser_download_url
  )) || release.assets.find((asset) => (
    /\.exe$/i.test(String(asset.name || ""))
    && asset.browser_download_url
  )) || null;
}

function setReleaseVersion(version) {
  document.querySelectorAll("[data-release-version]").forEach((element) => {
    element.textContent = version;
  });
  document.querySelectorAll("[data-release-version-label]").forEach((element) => {
    element.textContent = `Version ${version}`;
  });
  document.querySelectorAll("[data-release-version-input]").forEach((input) => {
    if (!input.dataset.edited) input.value = version;
  });
}

function formatReleaseDate(value) {
  if (!value) return "Release date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Release date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  return `${(size / (1024 * 1024)).toFixed(size >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function applyLatestRelease(release) {
  if (!release) return;
  const version = versionFromRelease(release);
  const installer = findInstaller(release);
  setReleaseVersion(version);
  if (installer) setInstallerUrl(installer.browser_download_url);
  document.querySelectorAll("[data-latest-release-link]").forEach((link) => {
    link.href = release.html_url || releaseConfig.releasesUrl;
  });
  document.querySelectorAll("[data-release-date]").forEach((element) => {
    element.textContent = formatReleaseDate(release.published_at || release.created_at);
  });
}

function appendInlineMarkdown(parent, source) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        const link = document.createElement("a");
        link.textContent = linkMatch[1];
        link.href = linkMatch[2];
        link.rel = "noreferrer";
        parent.append(link);
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function renderReleaseNotes(container, markdown) {
  const lines = String(markdown || "")
    .replace(/^#\s+.*(?:\r?\n)+/, "")
    .split(/\r?\n/);
  let list = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (/^---+$/.test(line)) {
      container.append(document.createElement("hr"));
      list = null;
      continue;
    }
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      const element = document.createElement(heading[1].length === 2 ? "h3" : "h4");
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      list = null;
      continue;
    }
    const listItem = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (listItem) {
      if (!list) {
        list = document.createElement("ul");
        container.append(list);
      }
      const item = document.createElement("li");
      appendInlineMarkdown(item, listItem[1]);
      list.append(item);
      continue;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, line);
    container.append(paragraph);
    list = null;
  }

  if (!container.childElementCount) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Release notes are available on GitHub.";
    container.append(paragraph);
  }
}

function renderReleases(releases) {
  if (!releaseList) return;
  releaseList.replaceChildren();
  const latestStable = releases.find((release) => !release.prerelease);

  releases.forEach((release) => {
    const version = versionFromRelease(release);
    const installer = findInstaller(release);
    const article = document.createElement("article");
    article.className = "release-entry";

    const meta = document.createElement("div");
    meta.className = "release-entry-meta";
    const versionLabel = document.createElement("strong");
    versionLabel.textContent = version;
    meta.append(versionLabel);

    const date = document.createElement("time");
    date.dateTime = release.published_at || release.created_at || "";
    date.textContent = formatReleaseDate(date.dateTime);
    meta.append(date);

    const badges = document.createElement("div");
    badges.className = "release-badges";
    if (release.id === latestStable?.id) {
      const latestBadge = document.createElement("span");
      latestBadge.className = "release-badge latest";
      latestBadge.textContent = "Latest";
      badges.append(latestBadge);
    }
    if (release.prerelease) {
      const previewBadge = document.createElement("span");
      previewBadge.className = "release-badge";
      previewBadge.textContent = "Preview";
      badges.append(previewBadge);
    }
    if (badges.childElementCount) meta.append(badges);

    const content = document.createElement("div");
    content.className = "release-entry-content";
    const heading = document.createElement("h2");
    heading.textContent = release.name || `Minova Chromium ${version}`;
    content.append(heading);

    const notes = document.createElement("div");
    notes.className = "release-notes";
    renderReleaseNotes(notes, release.body);
    content.append(notes);

    const actions = document.createElement("div");
    actions.className = "release-actions";
    if (installer) {
      const download = document.createElement("a");
      download.className = "button primary";
      download.href = installer.browser_download_url;
      download.textContent = `Download for Windows${installer.size ? ` \u00b7 ${formatFileSize(installer.size)}` : ""}`;
      actions.append(download);
    }
    const details = document.createElement("a");
    details.className = "button subtle";
    details.href = release.html_url;
    details.textContent = "View on GitHub";
    actions.append(details);
    content.append(actions);

    article.append(meta, content);
    releaseList.append(article);
  });
}

function normalizeReleases(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.filter((release) => release && !release.draft && release.tag_name);
}

function readCachedReleases() {
  try {
    const cached = JSON.parse(localStorage.getItem(releaseCacheKey) || "null");
    return normalizeReleases(cached?.releases);
  } catch {
    return [];
  }
}

function cacheReleases(releases) {
  try {
    localStorage.setItem(releaseCacheKey, JSON.stringify({
      savedAt: Date.now(),
      releases
    }));
  } catch {
    // Private browsing or storage policy may disable localStorage.
  }
}

function applyReleaseData(releases, source) {
  const stableReleases = releases.filter((release) => !release.prerelease);
  applyLatestRelease(stableReleases[0] || releases[0]);
  renderReleases(releases);
  if (releaseStatus) {
    releaseStatus.textContent = source === "live"
      ? `${releases.length} releases \u00b7 Synced with GitHub`
      : `${releases.length} releases \u00b7 Showing saved data`;
  }
}

async function refreshReleaseData() {
  try {
    const response = await fetch(releasesApiUrl, {
      cache: "no-store",
      headers: { accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error(`Release lookup failed with ${response.status}.`);
    const releases = normalizeReleases(await response.json());
    if (!releases.length) throw new Error("No public releases were returned.");
    cacheReleases(releases);
    applyReleaseData(releases, "live");
  } catch {
    if (releaseStatus && !readCachedReleases().length) {
      releaseStatus.textContent = "Live release history is temporarily unavailable.";
    }
  }
}

setInstallerUrl(fallbackInstallerUrl);
setReleaseVersion(fallbackVersion);

document.querySelectorAll("[data-release-version-input]").forEach((input) => {
  input.addEventListener("input", () => {
    input.dataset.edited = "true";
  });
});

const cachedReleases = readCachedReleases();
if (cachedReleases.length) applyReleaseData(cachedReleases, "cache");
if (releaseDownloadLinks.length || releaseList) {
  refreshReleaseData();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refreshReleaseData();
  }, Math.max(60000, Number(releaseConfig.releasePollIntervalMs) || 300000));
}
