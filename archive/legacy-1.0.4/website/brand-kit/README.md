# Minova Visual Identity

This directory is the source of truth for the Minova Chromium visual identity.
It combines the **Prism M** product symbol with the custom **MINOVA** wordmark.

## Brand Idea

**Shape your own path.**

Minova is a personal Chromium browser built around choice, focus, privacy, and
powerful local tools. The Prism M is built from two directional ribbons that
converge into one clear form, representing different browsing paths shaped into
one focused, personal experience.

## Directory

- `minova-brand-guide.html` - visual, browser-based brand book.
- `brand.css` - styles used by the visual brand book.
- `references/minova-wordmark-approved.png` - approved 842 x 146 outline-free wordmark reference.
- `assets/minova-symbol-color.svg` - authoritative vector app icon.
- `assets/minova-wordmark-dark.svg` - authoritative vector standalone name logo.
- `assets/minova-lockup-dark.svg` - authoritative vector horizontal lockup.
- `assets/minova-orbit-pattern.svg` - supporting brand pattern.
- `tokens/minova-brand-tokens.css` - CSS custom properties for product and web UI.
- `tokens/minova-brand-tokens.json` - platform-neutral design token source.
- `templates/minova-release-cover.svg` - editable 16:9 release artwork.
- `templates/minova-social-banner.svg` - editable repository and social banner.
- `templates/minova-installer-panel.svg` - editable installer artwork.
- `scripts/export-brand-assets.ps1` - deterministic PNG and ICO exporter.
- `exports/` - generated raster assets. Do not edit these by hand.

## Export Assets

From the project root:

```powershell
pnpm run brand:export
```

On Windows, developers can also double-click `Export Minova Brand Assets.cmd`
inside this directory.

## Build The Complete Kit

From the project root, run `Build Minova Brand Kit.cmd`. It creates the clean
`Minova Brand Kit` folder and `dist/brand/Minova-Brand-Kit-2.1.zip`, containing
only the approved guide, masters, exports, tokens, templates, and license.

The exporter renders the approved vector artwork and produces app icons at 16,
24, 32, 48, 64, 128, 256, 512, and 1024 pixels, a multi-size Windows ICO, and
PNG versions of the standalone wordmark and main lockup.

## Core Rules

1. Use the full lockup when Minova is being introduced for the first time.
2. Use the Prism M alone only where the product name is already understood.
3. Preserve clear space equal to one quarter of the symbol width.
4. Keep the left ribbon blue and the right ribbon cyan/teal in color artwork.
5. Never stretch, rotate, outline, bevel, or add glow to the logo.
6. Preserve the cyan O segment exactly as supplied in the approved wordmark.
7. Do not add a dark keyline around the white letterforms; edge transparency is intentional.
8. Product interfaces use an 8 px maximum corner radius.
9. Dark graphite is the default brand canvas; light mode is cool gray, not white.
10. Do not redraw or approximate the M or wordmark. The three SVG files in
   `assets/` are the definitive masters.

## Approved Taglines

- Primary: **Shape your own path.**
- Product: **The web, shaped around you.**
- Utility: **Your browser, your way.**

Use one tagline per composition. Do not combine them into a single message.

## Product Name

- Product name: **Minova**
- Full technical name: **Minova Chromium**
- Never write: `MiNova`, `MIN0VA`, `Minova Browser Chromium`, or `MinovaChrome`.
