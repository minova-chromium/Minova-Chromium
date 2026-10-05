const title = document.querySelector("#promptTitle");
const message = document.querySelector("#promptMessage");
const detail = document.querySelector("#promptDetail");
const enterButton = document.querySelector("#enterButton");
const closeButton = document.querySelector("#closeButton");
const notNowButton = document.querySelector("#notNowButton");

function render(state = {}) {
  const service = state.service || "This streaming service";
  const failed = state.reason === "playback-error" || state.reason === "load-error";
  title.textContent = failed ? `${service} playback needs help` : `${service} supports Streaming Mode`;
  message.textContent = failed
    ? `Minova detected a playback problem. Use the protected streaming engine without leaving this tab.`
    : `For protected video, switch to the signed streaming engine while keeping Minova's toolbar.`;
  detail.hidden = !state.detail;
  detail.textContent = state.detail ? `Detected: ${state.detail}` : "";
}

async function enterStreamingMode() {
  enterButton.disabled = true;
  enterButton.textContent = "Starting...";
  try {
    await window.minovaStreamingPrompt.enter();
  } catch (error) {
    enterButton.disabled = false;
    enterButton.textContent = "Try Streaming Mode again";
    detail.hidden = false;
    detail.textContent = error?.message || "Streaming Mode could not start.";
  }
}

enterButton.addEventListener("click", enterStreamingMode);
closeButton.addEventListener("click", () => window.minovaStreamingPrompt.dismiss());
notNowButton.addEventListener("click", () => window.minovaStreamingPrompt.dismiss());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.minovaStreamingPrompt.dismiss();
});

window.minovaStreamingPrompt.onState(render);
window.minovaStreamingPrompt.getState().then(render);
