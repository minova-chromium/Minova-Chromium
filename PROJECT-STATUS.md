# Minova Chromium: temporarily discontinued

Development is paused from October 5, 2026 until further notice. There is no announced restart date.

The website, source, brand assets, release notes, and existing releases remain public for reference and future development. No new features, bug fixes, security updates, or support are promised during the pause. Existing installers are archived software; use an actively maintained browser for everyday browsing.

## Recovering the project

```powershell
git clone https://github.com/minova-chromium/Minova-Chromium.git
cd Minova-Chromium
pnpm install --frozen-lockfile
pnpm run build:assistant
pnpm start
```

Use the pinned Castlabs Electron dependency. The current source reports development version 1.0.6; the last published browser release is v1.0.5. The development snapshot is not a new supported release.

To rebuild the packaged application:

```powershell
pnpm run pack
pnpm run installer:build
```

The packaged launcher reads compiled files under dist, so rebuild before verifying source changes through that launcher. Configure publishing and signing credentials separately through environment variables or the encrypted credential helper.

## Archive contents

- The repository root contains the authoritative browser source, lockfile, scripts, installer source, tests, extension source, and brand identity.
- website/ contains the maintained website source. HTML and website assets are also mirrored at the repository root for GitHub Pages.
- archive/legacy-1.0.4 preserves the older staging source, clearly separated from the authoritative source.
- archive/source-backup and archive/website-backup preserve prior source snapshots.
- archive/hybrid preserves the experimental streaming browser source.
- archive/audio-studio-chrome preserves the standalone Chrome extension.
- Existing release installers and updater payloads remain under GitHub Releases.

Personal browser profiles, history, passwords, cookies, credentials, signing material, raw conversations, debug captures, test output, dependencies, caches, and compiled local builds are excluded. Workstation usernames in text files have been replaced with DEVELOPER. The public project contact address remains intentional.

Source remains licensed GPL-3.0-only; third-party components retain their own licenses.
