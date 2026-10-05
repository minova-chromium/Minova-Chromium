const form = document.querySelector("#feedbackForm");
const email = document.querySelector("#email");
const subject = document.querySelector("#subject");
const description = document.querySelector("#description");
const website = document.querySelector("#website");
const characterCount = document.querySelector("#characterCount");
const status = document.querySelector("#status");
const sendButton = document.querySelector("#sendButton");
const cancelButton = document.querySelector("#cancelButton");
const closeButton = document.querySelector("#closeButton");
const title = document.querySelector("#dialogTitle");
const help = document.querySelector("#dialogDescription");
let state = { type: "bug", subject: "Bug Report", submitting: false };
let submitted = false;

function setStatus(message = "", type = "") {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function applyState(nextState = {}) {
  state = { ...state, ...nextState };
  const feature = state.type === "feature";
  title.textContent = feature ? "Request a Feature" : "Report a Bug";
  help.textContent = feature
    ? "Describe the improvement and the problem it would solve."
    : "Tell us what happened and how to reproduce it.";
  if (!subject.value || ["Bug Report", "Feature Request"].includes(subject.value)) {
    subject.value = state.subject || (feature ? "Feature Request" : "Bug Report");
  }
  const busy = Boolean(state.submitting);
  sendButton.disabled = busy || submitted;
  cancelButton.disabled = busy;
  closeButton.disabled = busy;
  sendButton.classList.toggle("loading", busy);
  sendButton.querySelector(".button-label").textContent = busy ? "Sending" : submitted ? "Sent" : "Send";
}

function validate() {
  const fields = [email, subject, description];
  for (const field of fields) field.removeAttribute("aria-invalid");
  if (!email.validity.valid || email.value.trim().length > 254) {
    email.setAttribute("aria-invalid", "true");
    email.focus();
    return "Enter a valid email address.";
  }
  const subjectLength = subject.value.trim().length;
  if (subjectLength < 3 || subjectLength > 120) {
    subject.setAttribute("aria-invalid", "true");
    subject.focus();
    return "Subject must be between 3 and 120 characters.";
  }
  const descriptionLength = description.value.trim().length;
  if (descriptionLength < 20 || descriptionLength > 5000) {
    description.setAttribute("aria-invalid", "true");
    description.focus();
    return "Description must be between 20 and 5,000 characters.";
  }
  return "";
}

description.addEventListener("input", () => {
  characterCount.textContent = String(description.value.length);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.submitting || submitted) return;
  const validationError = validate();
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }
  setStatus("Sending feedback securely...");
  applyState({ submitting: true });
  try {
    const result = await window.minovaFeedback.submit({
      email: email.value,
      subject: subject.value,
      description: description.value,
      website: website.value
    });
    submitted = true;
    setStatus(result.message || "Thank you. Your feedback was sent.", "success");
  } catch (error) {
    setStatus(error.message || "Feedback could not be sent. Please try again.", "error");
  } finally {
    applyState({ submitting: false });
  }
});

cancelButton.addEventListener("click", () => window.minovaFeedback.close());
closeButton.addEventListener("click", () => window.minovaFeedback.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !state.submitting) window.minovaFeedback.close();
});

window.minovaFeedback.onState(applyState);
window.minovaFeedback.getState().then((initialState) => {
  if (initialState) applyState(initialState);
  email.focus();
});
