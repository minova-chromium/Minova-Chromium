# Minova Hybrid Browser

Minova Hybrid Browser combines the custom Minova interface with the installed,
Microsoft-signed Edge browser engine. The web page, media pipeline, codecs,
Widevine/PlayReady components, user agent, and security sandbox all remain Edge.

## Start

Double-click `Launch Minova Hybrid Browser.cmd`.

The browser keeps a separate profile at:

`%LOCALAPPDATA%\Minova Hybrid Browser`

This keeps Minova cookies, accounts, history, bookmarks, passwords, and
extensions separate from the user's normal Edge profile. Edge extensions can be
installed from Microsoft Edge Add-ons or the Chrome Web Store in this profile.

## Architecture

The launcher starts Microsoft Edge in app mode and connects over a private,
inherited Chromium DevTools pipe. The pipe installs the local Minova interface
extension for that browser session before the first page is navigated. It does
not expose a TCP debugging port, spoof the user agent, disable the sandbox,
disable web security, or copy DRM binaries.

Streaming support is therefore the support provided by the installed Edge
version, the user's Windows edition, hardware, account, subscription, and
region. No application can guarantee access to every title or service.

## License

Minova's source code is licensed under GPL-3.0-only. Microsoft Edge and the
bundled Node.js runtime remain under their respective third-party licenses and
are not relicensed by Minova.
