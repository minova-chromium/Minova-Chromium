# Minova Chromium website

This folder is the static GitHub Pages site for Minova Chromium.

## Local preview

From the repository root:

```powershell
python -m http.server 4173 --directory website
```

Then open `http://127.0.0.1:4173/`.

## Release synchronization

`assets/releases.js` reads the public GitHub Releases API configured in
`assets/site-config.js`. The latest stable release automatically updates:

- Every download button and its installer URL
- Version labels on the home page
- The Minova version field on the feedback form
- The complete release history and release notes on `releases.html`

The site checks for fresh release data when a page opens and every five minutes
while it remains visible. The most recent successful response is cached in the
browser, and version `1.0.2` remains as a static fallback if GitHub is temporarily
unavailable. Publishing a new non-draft GitHub Release with a
`Minova-Chromium-Setup-<version>.exe` asset does not require another website
deployment.

## Feedback delivery

The public form supports two delivery paths:

1. Set `feedbackEndpoint` in `assets/site-config.js` to the deployed
   `server/feedback-service.mjs` `/v1/feedback` endpoint. This is the preferred
   production path.
2. When no endpoint is configured, the page uses FormSubmit's AJAX relay to
   deliver to `minova.chromium@gmail.com`. FormSubmit sends a one-time activation
   email before it will forward public submissions.

For the first-party service, set:

```text
MINOVA_FEEDBACK_ALLOWED_ORIGINS=https://minova-chromium.github.io
```

Keep the Resend API key only in the service host's secret manager.
