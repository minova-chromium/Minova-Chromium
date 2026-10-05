const steps = [
  { label: "Welcome" },
  { label: "Choose your interface" },
  { label: "Your workflow" },
  { label: "Power features" },
  { label: "Import passwords" }
];

const state = {
  step: 0,
  selectedLayout: "workspaces",
  googlePasswordImportState: "not-started",
  googlePasswordsImported: false,
  busy: false
};

const content = document.querySelector("#tourContent");
const progressItems = [...document.querySelectorAll("#tourProgress li")];
const progressLabel = document.querySelector("#progressLabel");
const skipButton = document.querySelector("#skipTourButton");
const backButton = document.querySelector("#backButton");
const nextButton = document.querySelector("#nextButton");
const stepDots = document.querySelector("#stepDots");

function browserVisual() {
  return `
    <div class="browser-visual" aria-hidden="true">
      <div class="browser-titlebar"><i></i><i></i><i></i><strong>Minova</strong></div>
      <div class="browser-toolbar"><i></i><i></i><b>Search or enter a web address</b><i></i><i></i></div>
      <div class="browser-stage">
        <div class="browser-sidebar"><i></i><i></i><i></i><i></i></div>
        <div class="browser-page">
          <div class="browser-page-content">
            <img src="../assets/logos/minova-browser.png" alt="" />
            <strong>Minova</strong>
            <div class="browser-search"></div>
            <div class="shortcut-row"><i></i><i></i><i></i><i></i></div>
          </div>
          <span class="callout tabs">Workspaces</span>
          <span class="callout theme">Your colors</span>
          <span class="callout stream">Streaming Mode</span>
        </div>
      </div>
    </div>`;
}

function miniBrowser(type) {
  if (type === "classic") {
    return `
      <div class="mini-browser classic" aria-hidden="true">
        <div class="mini-title"></div>
        <div class="mini-tabs"><i></i><i></i><i></i></div>
        <div class="mini-toolbar"><i></i><i></i><b></b><i></i></div>
        <div class="mini-page"><span></span></div>
      </div>`;
  }
  return `
    <div class="mini-browser" aria-hidden="true">
      <div class="mini-title"></div>
      <div class="mini-toolbar"><i></i><i></i><b></b><i></i></div>
      <div class="mini-body workspace">
        <div class="mini-side"><i></i><i></i><i></i></div>
        <div class="mini-page"><span></span></div>
      </div>
    </div>`;
}

function renderWelcome() {
  return `
    <article class="step-page welcome-grid">
      <div class="welcome-copy">
        <img class="welcome-logo" src="../assets/logos/minova-browser.png" alt="Minova logo" />
        <p class="step-kicker">Welcome to your browser</p>
        <h1>Set up Minova around the way you browse.</h1>
        <p class="step-lead">Choose the interface that feels right, see what Minova can do, and bring your saved logins into its encrypted vault.</p>
        <div class="welcome-points">
          <span class="welcome-point"><i>&check;</i>Chromium compatibility with Minova controls</span>
          <span class="welcome-point"><i>&check;</i>Custom workspaces, themes, extensions, and media tools</span>
          <span class="welcome-point"><i>&check;</i>A local profile protected on this Windows account</span>
        </div>
      </div>
      ${browserVisual()}
    </article>`;
}

function renderLayoutChoice() {
  const workspaceSelected = state.selectedLayout === "workspaces";
  return `
    <article class="step-page">
      <p class="step-kicker">Choose your interface</p>
      <h1>Two ways to make Minova yours.</h1>
      <p class="step-lead">Your choice applies immediately and can be changed later in Settings &gt; Appearance.</p>
      <div class="layout-choice-grid">
        <button class="layout-choice ${workspaceSelected ? "selected" : ""}" type="button" data-layout="workspaces" aria-pressed="${workspaceSelected}">
          <div class="layout-choice-copy">
            <strong>Workspace UI</strong>
            <span class="choice-check" aria-hidden="true">&check;</span>
            <p>Vertical tabs, color-coded contexts, collapsible navigation, and side-by-side Split View for focused multitasking.</p>
          </div>
          ${miniBrowser("workspaces")}
        </button>
        <button class="layout-choice ${workspaceSelected ? "" : "selected"}" type="button" data-layout="classic" aria-pressed="${!workspaceSelected}">
          <div class="layout-choice-copy">
            <strong>Classic UI</strong>
            <span class="choice-check" aria-hidden="true">&check;</span>
            <p>Traditional horizontal tabs and a familiar browser flow, with Minova's streaming, extension, theme, and privacy tools intact.</p>
          </div>
          ${miniBrowser("classic")}
        </button>
      </div>
    </article>`;
}

function workspaceWorkflowVisual() {
  return `
    <div class="workflow-visual" aria-hidden="true">
      <div class="workflow-title">Personal</div>
      <div class="workflow-toolbar"><i></i><i></i><i></i><b></b><i></i></div>
      <div class="workflow-main">
        <div class="workflow-sidebar"><span></span><span></span><span></span></div>
        <div class="workflow-page"><span>Research</span><span>Reference</span></div>
      </div>
    </div>`;
}

function classicWorkflowVisual() {
  return `
    <div class="workflow-visual classic" aria-hidden="true">
      <div class="workflow-title">Minova</div>
      <div class="workflow-tabs"><span>Mail</span><span>Video</span><span>News</span></div>
      <div class="workflow-toolbar"><i></i><i></i><i></i><b></b><i></i></div>
      <div class="workflow-main no-sidebar">
        <div class="workflow-page"><span>Active webpage</span><span>Pinned tools</span></div>
      </div>
    </div>`;
}

function renderWorkflow() {
  const workspace = state.selectedLayout === "workspaces";
  const capabilities = workspace
    ? [
        ["01", "Spaces that match your day", "Keep Personal, Work, Gaming, or any custom context visually separated. Rename, recolor, add, and delete spaces at any time."],
        ["02", "Vertical tabs built for volume", "Scan favicons and titles down the sidebar, collapse it when you want more page room, and keep tabs inside the space where they belong."],
        ["03", "Split View without extra windows", "Place two regular webpages side by side. Minova keeps both native views alive and remembers which pane is focused."],
        ["04", "Fast context switching", "Move between spaces without destroying their tabs. Each workspace remembers its active tab and its own arrangement."]
      ]
    : [
        ["01", "The browser shape you already know", "Tabs remain across the top with a familiar active-tab rhythm and direct close controls."],
        ["02", "Minova tools stay within reach", "Streaming Mode, pinned extensions, bookmarks, themes, downloads, passwords, and the quick menu remain in the toolbar."],
        ["03", "Clean focus on one page", "The classic layout dedicates the full width below the toolbar to the active site and avoids a persistent side rail."],
        ["04", "Switch whenever you like", "Workspace UI remains one setting away whenever you want vertical tabs, custom contexts, or Split View."]
      ];
  return `
    <article class="step-page">
      <p class="step-kicker">${workspace ? "Workspace UI selected" : "Classic UI selected"}</p>
      <h1>${workspace ? "Organize tabs by context, not clutter." : "Familiar tabs, with Minova underneath."}</h1>
      <p class="step-lead">${workspace ? "Your sidebar is a working surface: customizable spaces at the top, live tabs in the middle, and focused commands below." : "Classic UI keeps the horizontal tab model while retaining the browser's deeper media, privacy, extension, and customization features."}</p>
      <div class="workflow-grid">
        ${workspace ? workspaceWorkflowVisual() : classicWorkflowVisual()}
        <div class="capability-list">
          ${capabilities.map(([icon, title, description]) => `
            <div class="capability">
              <span class="capability-icon">${icon}</span>
              <div><strong>${title}</strong><p>${description}</p></div>
            </div>`).join("")}
        </div>
      </div>
    </article>`;
}

function renderFeatures() {
  const features = [
    ["TV", "Protected Streaming Mode", "Open supported services through Minova's attached certified streaming surface while keeping the custom browser chrome."],
    ["EX", "Chrome extensions", "Install compatible extensions, pin their actions to the toolbar, and manage them from Minova's Extensions page."],
    ["UI", "Fully custom themes", "Choose the browser background, toolbar, active controls, borders, text, accents, and warning colors."],
    ["AV", "Audio Studio", "Use picture-in-picture, media detection, transparent normalization, a ten-band parametric EQ, and custom audio presets."],
    ["SH", "Smart tab suspension", "Reduce inactive-tab resource use with adjustable timing and exclusions for pinned, audio, capture, or unsaved tabs."],
    ["PW", "Encrypted autofill", "Saved credentials stay in Minova's Windows-protected local vault and appear only on their matching site."]
  ];
  return `
    <article class="step-page">
      <p class="step-kicker">More than a tab strip</p>
      <h1>Power features, without leaving the browser.</h1>
      <p class="step-lead">The same feature set is available in both interface styles. Workspace UI adds contexts and Split View; Classic UI keeps the traditional tab arrangement.</p>
      <div class="feature-grid">
        ${features.map(([icon, title, description]) => `
          <section class="feature-card">
            <span class="feature-icon">${icon}</span>
            <strong>${title}</strong>
            <p>${description}</p>
          </section>`).join("")}
      </div>
    </article>`;
}

function renderPasswords() {
  const imported = state.googlePasswordsImported || state.googlePasswordImportState === "complete";
  return `
    <article class="step-page">
      <p class="step-kicker">Last step</p>
      <h1>Bring your saved logins into Minova.</h1>
      <p class="step-lead">Minova can import a Google Password Manager export into its local Windows-encrypted vault, where matching logins can appear directly in site forms.</p>
      <div class="password-layout">
        <div class="vault-visual" aria-hidden="true">
          <span class="vault-badge one">Google export</span>
          <span class="vault-badge two">Site-matched autofill</span>
          <span class="vault-badge three">Windows encryption</span>
          <div class="vault-ring"><div class="vault-lock">MINOVA VAULT</div></div>
        </div>
        <div class="password-panel">
          <div class="password-notice"><strong>Why an export?</strong> Google does not provide third-party Chromium browsers with direct Google Account password sync. Minova uses Google's official CSV export route and encrypts imported entries locally.</div>
          ${imported ? `
            <div class="password-complete">
              <strong>Your Google passwords are already imported.</strong>
              <p>They are available to Minova's site-matched autofill. You can resync or export them later from Passwords and Autofill.</p>
              <button class="primary-button password-finish-button" type="button" data-password-action="finish">Finish setup</button>
            </div>` : `
            <div class="password-actions">
              <button class="password-action primary" type="button" data-password-action="google">
                <i>G</i><div><strong>Open Google Password Manager</strong><small>Export there; Minova watches for the verified CSV download and imports it automatically.</small></div><span>&rarr;</span>
              </button>
              <button class="password-action csv" type="button" data-password-action="csv">
                <i>CSV</i><div><strong>Choose an export I already have</strong><small>Select a Google Password Manager CSV and import it into the encrypted vault now.</small></div><span>&rarr;</span>
              </button>
              <button class="password-action later" type="button" data-password-action="later">
                <i>&minus;</i><div><strong>Not now</strong><small>Finish Minova setup without importing. The same options remain in Passwords and Autofill.</small></div><span>&rarr;</span>
              </button>
            </div>`}
          <p class="password-status" id="passwordStatus" role="status"></p>
        </div>
      </div>
    </article>`;
}

function bindStepActions() {
  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.busy) return;
      state.selectedLayout = button.dataset.layout === "classic" ? "classic" : "workspaces";
      render();
      try {
        const nextState = await window.minovaTour.chooseLayout(state.selectedLayout);
        state.selectedLayout = nextState.selectedLayout;
        render();
      } catch (error) {
        console.error("Minova could not apply the selected layout:", error);
      }
    });
  });

  document.querySelectorAll("[data-password-action]").forEach((button) => {
    button.addEventListener("click", () => finishPasswordStep(button.dataset.passwordAction));
  });
}

async function finishPasswordStep(action) {
  if (state.busy) return;
  state.busy = true;
  const status = document.querySelector("#passwordStatus");
  document.querySelectorAll("[data-password-action]").forEach((button) => { button.disabled = true; });
  if (status) status.textContent = action === "csv" ? "Opening your Google password export..." : "Finishing Minova setup...";
  try {
    const result = await window.minovaTour.finish(action);
    if (result?.canceled) {
      state.busy = false;
      if (status) status.textContent = "No file was selected. Your setup is still open.";
      document.querySelectorAll("[data-password-action]").forEach((button) => { button.disabled = false; });
    }
  } catch (error) {
    state.busy = false;
    if (status) {
      status.textContent = error.message || "Minova could not finish that password action.";
      status.classList.add("error");
    }
    document.querySelectorAll("[data-password-action]").forEach((button) => { button.disabled = false; });
  }
}

function renderProgress() {
  progressItems.forEach((item, index) => {
    item.classList.toggle("active", index === state.step);
    item.classList.toggle("complete", index < state.step);
    const marker = item.querySelector(":scope > span");
    marker.textContent = index < state.step ? "\u2713" : String(index + 1);
  });
  progressLabel.textContent = `${state.step + 1} of ${steps.length} - ${steps[state.step].label}`;
  stepDots.replaceChildren(...steps.map((_, index) => {
    const dot = document.createElement("i");
    dot.classList.toggle("active", index === state.step);
    return dot;
  }));
}

function render() {
  const renderers = [renderWelcome, renderLayoutChoice, renderWorkflow, renderFeatures, renderPasswords];
  content.innerHTML = renderers[state.step]();
  renderProgress();
  backButton.disabled = state.step === 0 || state.busy;
  nextButton.classList.toggle("hidden", state.step === steps.length - 1);
  skipButton.classList.toggle("hidden", state.step === steps.length - 1);
  bindStepActions();
  content.scrollTop = 0;
}

function goToStep(step) {
  if (state.busy) return;
  state.step = Math.max(0, Math.min(steps.length - 1, step));
  render();
}

backButton.addEventListener("click", () => goToStep(state.step - 1));
nextButton.addEventListener("click", () => goToStep(state.step + 1));
skipButton.addEventListener("click", () => goToStep(steps.length - 1));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.step < steps.length - 1) goToStep(steps.length - 1);
});

render();
window.minovaTour.getState().then((initialState) => {
  state.selectedLayout = initialState.selectedLayout === "classic" ? "classic" : "workspaces";
  state.googlePasswordImportState = initialState.googlePasswordImportState || "not-started";
  state.googlePasswordsImported = Boolean(initialState.googlePasswordsImported);
  render();
}).catch((error) => {
  console.error("Minova could not load the first-run state:", error);
  render();
});
