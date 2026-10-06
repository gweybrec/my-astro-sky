# Logos

- `icon.png` — the MyAstroSky app logo: a 1254 × 1254 px square PNG (RGB, about 1.0 MB) drawing a white-line astronomer beside a telescope on a tripod, looking at a framed nebula photograph, with plus-shaped and round stars on a pure black ground. It is a full-colour raster picture, not a single-ink mark: it carries its own black background and is shown as an `<img>`, never recoloured with CSS.

Where the app uses it: the browser tab icon (`index.html`, `<link rel="icon">`), the Electron window icon (`electron/main.ts`), and a copy for the documentation site (`docs/icon.png`, kept in sync by `npm run verify:icon`).

Use it on a dark ground at 32px or larger, square, uncropped. There is no wordmark file: set the name "MyAstroSky" in plain type (the `display` family, Cormorant Garamond) next to the icon. Do not redraw or recolour the logo.
