# Minova Chromium Windows Releases

## Build an updater-compatible installer

Update the semantic version in `package.json`, then double-click:

```text
Build Minova Installer.cmd
```

Add `release-notes\<version>.md` before building when the release needs a
curated GitHub changelog. The publisher uses that file as the GitHub Release
description; when it is absent, GitHub-generated notes remain enabled.

The command runs the unit checks and creates the complete Windows release under
`dist\update`:

- `Minova-Chromium-Setup-<version>.exe`
- `Minova-Chromium-Update-<version>.exe`
- `Minova-Chromium-Update-<version>.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `release-files.json`

`Setup` is the branded installer people download from the website. It verifies
and silently runs the embedded updater-compatible package. `Update` is the NSIS
payload Minova downloads in the background; `latest.yml` points to it and the
blockmap enables differential downloads when possible.

Run the non-installing verification before publishing:

```text
Test Minova Installer.cmd
```

This test verifies the embedded package checksum and exercises the native
installer's ready, progress, and completion states without changing Windows
registration or installing Minova.

## Publish to GitHub

Double-click:

```text
Publish Minova GitHub Release.cmd
```

The publisher uses `GH_TOKEN` or `GITHUB_TOKEN` when one is already available,
then tries an authenticated GitHub CLI session. Otherwise it uses the
Windows-encrypted Minova developer credential. Save or replace that credential
by double-clicking:

```text
Save Minova GitHub Token.cmd
```

Create a fine-grained token at:

```text
https://github.com/settings/personal-access-tokens/new
```

Give the token access to the `Minova-Chromium` repository with
`Contents: Read and write`. The pasted value is hidden. Its encrypted form is
protected by Windows DPAPI for the current Windows account and stored outside
the source tree. Use `Remove Minova GitHub Token.cmd` to delete it.

For automation or CI, set a GitHub token in the current process or secret store:

```powershell
$env:GH_TOKEN = "your-temporary-token"
.\Publish Minova GitHub Release.cmd
```

Never place the token in `package.json`, a command file, or source control.
The publisher targets:

```text
https://github.com/minova-chromium/Minova-Chromium
```

The publish command creates or updates the matching GitHub Release and uploads
the branded Setup EXE, updater payload, blockmap, metadata, and checksums. GitHub
release notes appear in Minova's branded Restart and update / Later prompt.
Publishing validates and uploads the artifacts produced by
`Build Minova Installer.cmd`; it never rebuilds them. This keeps the published
files identical to the installer that was tested and removes package-manager
state from the upload step.
After every completely successful publication, the patch number in
`package.json` advances automatically. Publishing `1.0.2` therefore prepares
`1.0.3` for the next build. Failed or cancelled uploads do not change the
version.

## Release checklist

1. Confirm `package.json` contains the version intended for this release.
2. Create `release-notes\<version>.md` from `release-notes\TEMPLATE.md`. Match the polished 1.0.3 format: one H1, emoji H3 sections, bold user-facing bullet labels, a separator, and the Install / Update section.
3. Build the versioned promotional film before publication. Use a smooth neural voice, fixed pixel-stable scenes, eased transitions, a 1920x1080 H.264/AAC master, an external WebVTT caption track, and a versioned poster image.
4. Sample frames from every promo scene and check for movement jitter, clipping, unreadable text, incorrect screenshots, or captions baked into the video.
5. Update the website player, poster, runtime, release copy, and current-version feature section. Append the new film to `website\videos.html` without removing earlier release videos. Keep `controlslist="nodownload"` and leave captions optional rather than enabled by default.
6. Commit the source and create a matching tag such as `v1.0.4`.
7. Double-click `Build Minova Installer.cmd`.
8. Double-click `Test Minova Installer.cmd`.
9. Install and launch the new setup on a test Windows account.
10. Run `Publish Minova GitHub Release.cmd` only after final approval.
11. Verify that the GitHub Release is public, uses the curated release-note style, and contains both EXE files.
12. Publish the website and verify the live release page, download target, latest promo film, permanent Videos archive, poster, and current version label.
13. Confirm `package.json` advanced to the next patch version.
14. Launch the previous installed version and inspect `%APPDATA%\minova-browser-v2\logs\updater.log`.

This changelog-and-film pass is required for every public Minova version. New
features added between releases should be collected in the next version's
release notes and represented in its promotional film instead of silently
replacing the previous release history.

Windows auto-update still uses the electron-builder NSIS payload. The branded
Setup EXE is a bootstrapper around that exact payload, so first installs and
background updates remain compatible.

## Signing

The local build is currently unsigned and can trigger Microsoft SmartScreen.
Production releases should Authenticode-sign Minova.exe, the updater payload,
and the branded Setup EXE before publication. The build prints a warning while
the Setup EXE remains unsigned. Castlabs VMP signing is separate and remains
required for protected playback directly inside Minova.
