"use strict";

(function initializeFeedbackPage() {
const config = window.MINOVA_SITE_CONFIG || {};
const form = document.querySelector("#publicFeedbackForm");
const typeButtons = Array.from(document.querySelectorAll("[data-feedback-type]"));
const feedbackType = document.querySelector("#feedbackType");
const status = document.querySelector("#feedbackStatus");
const submitButton = document.querySelector("#feedbackSubmit");
const description = document.querySelector("#feedbackDescription");
const count = document.querySelector("#feedbackCount");

function setType(type) {
  const nextType = type === "feature" ? "feature" : "bug";
  feedbackType.value = nextType;
  typeButtons.forEach((button) => {
    const active = button.dataset.feedbackType === nextType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#feedbackSubject").placeholder = nextType === "feature"
    ? "What should Minova add?"
    : "What went wrong?";
}

function setStatus(message = "", type = "") {
  status.textContent = message;
  status.className = `form-status ${type}`.trim();
}

async function submitToFirstParty(payload) {
  const response = await fetch(config.feedbackEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Feedback could not be sent.");
  return result;
}

async function submitToRelay(payload) {
  const recipient = config.feedbackRecipient || "minova.chromium@gmail.com";
  const message = {
    name: payload.name || "Minova user",
    type: payload.type === "feature" ? "Feature request" : "Bug report",
    subject: payload.subject,
    message: payload.description,
    version: payload.appVersion,
    platform: payload.platform || "Not provided",
    _subject: `[Minova ${payload.type === "feature" ? "Feature Request" : "Bug Report"}] ${payload.subject}`,
    _template: "table",
    _honey: payload.website
  };
  if (payload.email) message.email = payload.email;
  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(message)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Feedback could not be sent.");
  }
  return result;
}

typeButtons.forEach((button) => {
  button.addEventListener("click", () => setType(button.dataset.feedbackType));
});

description?.addEventListener("input", () => {
  count.textContent = String(description.value.length);
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.classList.add("loading");
  setStatus("Sending your feedback securely...");
  const formData = new FormData(form);
  const payload = {
    type: feedbackType.value,
    name: String(formData.get("name") || "").trim().slice(0, 80),
    email: String(formData.get("email") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    website: String(formData.get("website") || "").trim(),
    appVersion: String(formData.get("appVersion") || config.currentVersion || "").trim(),
    chromiumVersion: "",
    platform: String(formData.get("platform") || "").trim(),
    architecture: ""
  };

  try {
    const result = config.feedbackEndpoint
      ? await submitToFirstParty(payload)
      : await submitToRelay(payload);
    setStatus(result.message || "Thank you. Your feedback was sent to the Minova team.", "success");
    form.reset();
    setType("bug");
    count.textContent = "0";
  } catch (error) {
    setStatus(error.message || "Feedback could not be sent. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("loading");
  }
});

function setTypeFromLocation() {
  const requestedType = new URL(window.location.href).searchParams.get("type");
  setType(requestedType === "feature" ? "feature" : "bug");
}

setTypeFromLocation();
window.addEventListener("pageshow", setTypeFromLocation);
})();
