"use strict";

const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 24 * 60;
const DEFAULT_TIMEOUT_MINUTES = 30;

function normalizeTimeoutMinutes(value) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return DEFAULT_TIMEOUT_MINUTES;
  return Math.min(MAX_TIMEOUT_MINUTES, Math.max(MIN_TIMEOUT_MINUTES, minutes));
}

function normalizeExclusions(exclusions) {
  return (Array.isArray(exclusions) ? exclusions : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

function hostnameFromValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function exclusionMatches(value, exclusions) {
  const hostname = hostnameFromValue(value);
  if (!hostname) return false;
  return normalizeExclusions(exclusions).some((entry) => {
    const excludedHost = hostnameFromValue(entry);
    return Boolean(excludedHost)
      && (hostname === excludedHost || hostname.endsWith(`.${excludedHost}`));
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
  MIN_TIMEOUT_MINUTES,
  exclusionMatches,
  normalizeExclusions,
  normalizeTimeoutMinutes
};
