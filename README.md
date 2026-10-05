# Minova Browser

> **Temporarily discontinued, October 5, 2026.** Development is paused until further notice. Source and existing releases remain available, but updates and support are paused. Use an actively maintained browser for everyday browsing. See [project status and recovery instructions](PROJECT-STATUS.md).

Minova 1.0 is a Chromium-powered desktop browser built with Castlabs Electron for Content Security (ECS). It includes session restore, recently closed tabs, address-bar history suggestions, a real find-in-page bar, bookmarks, downloads, encrypted password storage, private tabs, extension actions, privacy controls, media tools, and integrated Streaming Mode.

## Minova 1.0

- Restores regular tabs after a restart; private tabs are never written to the session.
- Reopens recently closed tabs from the menu or with `Ctrl+Shift+T`.
- Searches the active page with match counts using `Ctrl+F`.
- Shows non-blocking status notifications for downloads, extensions, and browser actions.
- Supports keyboard navigation and visible focus states across the browser shell.
- Keeps certified streaming playback attached to the Minova window, including fullscreen.
- Imports Google Password Manager CSV exports into a Windows-encrypted vault and offers exact-origin autofill.
- Freezes eligible inactive tabs with configurable safety exclusions.
- Provides in-browser bug and feature feedback dialogs backed by a credential-free desktop client.
- Runs Minova Assistant locally through WebGPU with streamed chat and private page summaries.

## Windows Installer

Minova includes a native, branded Windows installer with per-user installation, configurable shortcuts, update and repair detection, rollback-safe version folders, and standard Windows uninstall registration. Developers can double-click `Build Minova Installer.cmd` or run `pnpm run installer:build`. See `DEVELOPER-RELEASE.md` for versioned release and signing instructions.

## Password Import Security

Minova cannot access proprietary Google Chrome Sync or silently extract passwords from a Google account. The supported flow opens Google Password Manager and watches for the CSV export only after the user starts import or resync. Minova validates Google's column headers, limits imports to 20 MB, encrypts each credential with Electron `safeStorage`, and offers to move the readable CSV to the Recycle Bin.

Minova intentionally does not create `passwords.txt` or sample plaintext credentials. Resync removes only previous Google imports; passwords created directly in Minova are preserved.

## Smart Tab Suspension

Settings > Tab Performance controls the inactivity timeout, safety policies, and website exclusions. Eligible background tabs are frozen through Chromium's supported page lifecycle API. Navigation state remains live in the renderer, so waking a tab does not replace the page or lose its session.

Minova skips active downloads, pinned tabs, audible media, playing video, selected file uploads, dirty forms, capture permissions, fullscreen pages, and excluded hosts. Camera or microphone permission is treated conservatively until the next top-level navigation.

## Feedback Service

The desktop browser sends feedback only to the HTTPS URL in `MINOVA_FEEDBACK_ENDPOINT`. No email or API credentials are shipped in the browser. The included dependency-free service validates input again, rate-limits by a hash of IP and email, suppresses duplicate submissions, fixes the recipient to `minova.chromium@gmail.com`, and reads its Resend key only from the server environment.

For local development:

```powershell
$env:RESEND_API_KEY = "server-side-secret"
$env:MINOVA_FEEDBACK_FROM = "Minova Feedback <feedback@your-verified-domain.example>"
$env:PORT = "8787"
pnpm run feedback:server

$env:MINOVA_FEEDBACK_ENDPOINT = "http://127.0.0.1:8787/v1/feedback"
pnpm start
```

For production, deploy `server/feedback-service.mjs` behind HTTPS, bind it to the platform-provided host and port, keep `RESEND_API_KEY` in the host's secret manager, and set `MINOVA_FEEDBACK_ENDPOINT` in the Minova release environment. Set `MINOVA_FEEDBACK_TRUST_PROXY=1` only behind a trusted reverse proxy; otherwise rate limiting uses the direct socket address. Add infrastructure-level rate limiting and bot protection in front of the service for public deployments.

## License

Minova is free software licensed under the GNU General Public License version 3 only (`GPL-3.0-only`). You may use, study, modify, and redistribute it under the terms in [LICENSE](LICENSE). Minova is provided without warranty.

Distributing a modified Minova build requires making the corresponding source code available under GPLv3. The bundled `electron-chrome-extensions` compatibility layer is used under its GPL-3.0 licensing option.

## Extension Compatibility

Minova supports Manifest V2 and Manifest V3 extensions through Electron plus `electron-chrome-extensions`. Actions, popups, tabs, windows, storage, cookies, context menus, permissions, and common runtime APIs are integrated. Electron is not Google Chrome, so extensions that depend on unsupported proprietary Chrome APIs may still be incompatible.

## Audio Studio

Audio Studio is built directly into Minova and opens from the speaker control in
the address toolbar. Every supported tab and frame receives one shared Web Audio
graph with transparent dynamic-range compression, ten parametric EQ bands,
automatic digital headroom, a safety limiter, per-tab gain up to 300%, mute,
bypass, and persistent built-in or custom presets. The graph is created lazily
when media plays and suspends after playback stops.

Protected DRM streams and cross-origin players without CORS stay on Chromium's
native playback path so audio processing cannot break certified streaming. The
standalone Manifest V3 edition for Google Chrome is in
`extensions/minova-audio-studio`; it is not required inside Minova.

## Minova Assistant

The sparkle button in the address toolbar opens Minova Assistant as a native
right sidebar. Chat generation and page summaries run inside a hidden,
sandboxed WebLLM worker accelerated by WebGPU. Minova uses
`Llama-3.2-1B-Instruct-q4f16_1-MLC` when the GPU supports 16-bit shaders and the
q4f32 variant as a compatibility fallback.

The selected model is downloaded on first use and stored in the persistent
`persist:minova-assistant` partition using WebLLM's IndexedDB cache. Later
launches reuse that local cache and can work offline. The initial model download
still requires an internet connection. Prompts and extracted page text are not
sent to an AI service, chat history remains in the current browser session, and
Summarize Page runs only after an explicit user action. Hardware acceleration
and a WebGPU-capable graphics driver are required.

## Protected Playback

Minova uses ECS `43.0.0+wvcus`. On first launch, ECS downloads the compatible Widevine CDM through Chromium's Component Updater and stores it in Minova's user-data directory. Minova waits for that installation before creating browser windows and allows the `mediaKeySystem` permission only for secure web origins.

Do not copy or redistribute `widevinecdm.dll` with Minova. Castlabs documents licensing concerns with bundling the CDM; the supported distribution method is the Component Updater download from Google.

Settings > System shows the ECS component status and links to the Castlabs VMP test. `navigator.plugins` is diagnostic only: Widevine support is verified through the standard Encrypted Media Extensions API (`navigator.requestMediaKeySystemAccess`).

### Production VMP Signing

The ECS download is development VMP-signed. Services such as Netflix require a production VMP signature. Microsoft Authenticode or Apple Developer ID signing does not replace VMP signing.

Run `node scripts/minova-drm-self-test.js` to exercise the official Castlabs VMP lab without a remote-debugging connection. A `PLATFORM_TAMPERED` result means EME and the CDM are present, but the executable still needs to be signed through EVS. Remote debugging must not be enabled for this test because it can invalidate a protected media path.

For Windows release builds, Minova's electron-builder `afterSign` hook runs Castlabs EVS after Authenticode signing when `MINOVA_VMP_SIGN=1`:

```powershell
py -3 -m pip install --upgrade castlabs-evs
py -3 -m castlabs_evs.account signup
$env:CSC_LINK = "C:\secure\minova-signing.pfx"
$env:CSC_KEY_PASSWORD = "your-certificate-password"
$env:MINOVA_VMP_SIGN = "1"
pnpm dist
```

The EVS account and refreshed authorization tokens must be available to the build machine. On Windows, Authenticode signing must happen before VMP signing. On macOS, VMP signing must happen before Apple code signing; Minova's current automated hook is Windows-only.

### Streaming Mode

Until Minova receives a production VMP signature, the toolbar's Streaming Mode button opens the current HTTPS page with the installed Microsoft-signed Edge browser and embeds its renderer in a clipped native host below Minova's toolbar. Minova's tabs and controls remain visible, an **Exit Streaming** control appears at the top-left, and the Edge surface follows Minova when the window moves, resizes, minimizes, or restores. Under the hood Edge remains a separate signed process, preserving its certified Widevine and PlayReady protected-media path without spoofing browser identity or weakening its sandbox. Cookies, service logins, playback preferences, and extensions persist in the dedicated `Minova Streaming` profile.

Open Minova normally, navigate to the service, then choose **Open in Streaming Mode** from the toolbar or main menu. Retired separate-streaming launchers are kept under `inactive\legacy-tools` for reference and are not part of the normal workflow. Streaming availability still depends on the service subscription, region, hardware, graphics driver, HDCP connection, and codecs installed on the computer.

## Run

Double-click `Launch Minova Browser.cmd`. It starts the newest unpacked build in
`dist\update\win-unpacked` when one is available, otherwise it runs the current
source through the local Electron runtime. Verified builds under
`runtime\fallback` remain available when the development runtime is unavailable.

You can also run this from PowerShell:

```powershell
cd "C:\Users\DEVELOPER\Documents\Minova Browser"
.\run-minova.ps1
```

If you have Node and pnpm on your PATH, you can also run:

```powershell
pnpm start
```

## Build Installer

```powershell
pnpm run installer:build
```

Or double-click `Build Minova Installer.cmd`. The release pipeline creates:

- `Minova-Chromium-Setup-<version>.exe`, the branded public installer.
- `Minova-Chromium-Update-<version>.exe`, Minova's updater-compatible NSIS payload.
- The updater blockmap, `latest.yml`, checksums, and release manifest.

Double-click `Test Minova Installer.cmd` to verify the branded install, progress,
and completion states without installing or changing the Windows registry.
Nothing is uploaded until `Publish Minova GitHub Release.cmd` is run.
`Save Minova GitHub Token.cmd` stores the release credential with Windows
user-scoped encryption outside the repository. After a complete upload, the
publisher automatically advances the patch version for the next release.

## Project Website

The public product website lives in `website/` and is deployed to GitHub Pages by
`.github/workflows/pages.yml` whenever either path changes on `main`.

Preview it locally from the repository root:

```powershell
python -m http.server 4173 --directory website
```

Then open `http://127.0.0.1:4173/`. The separate home, feature catalog, release
history, and feedback pages are static and require no site build step. Release
notes, installer links, and displayed versions synchronize with public GitHub
Releases automatically. See
`website/README.md` for feedback-delivery configuration.

## Project Organization

Double-click `Organize Minova Project.cmd` after a release cycle to move known
dated builds and retired tools out of the project root. Current source, build
output, installer tooling, release scripts, dependencies, and website files stay
in place. Verified fallback builds are kept under `runtime\fallback`; superseded
artifacts are moved under `inactive`. The organizer is idempotent and never
deletes files.
