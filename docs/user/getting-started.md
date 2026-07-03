# Getting Started

MyAstroSky is a web application — you open it in a browser, just like any website. No installation is required for the most common setups.

---

## How to access the app

Already have a link from someone, or the app open in your browser? Skip ahead to [Your first photo](#your-first-photo).

Otherwise, see [Installing MyAstroSky](/user/installing-app.md) for the desktop app (Windows, macOS, Linux — download and double-click, no terminal required), self-hosting for a group, or LAN sharing.

## What you need

- A modern browser: **Chrome**, **Firefox**, or **Edge** (latest version)
- No account, no sign-up required
- Optional: a free [astrometry.net](https://nova.astrometry.net) API key if you want to use the online plate solver

---

## Your first photo

Here is the shortest path to getting a photo onto the sky map:

### If your photo is a FITS file with WCS data

Most processing software (PixInsight, Siril, Astro Pixel Processor) can embed calibration data directly into the FITS file.

1. Click the **+** button in the Photos panel on the right.
2. Drop your `.fit` / `.fits` file or click to browse.
3. The upload modal will detect the WCS data — click **Use WCS metadata**.
4. Your photo appears on the map, precisely positioned.

### If your photo is a JPEG or PNG (no built-in coordinates)

1. Click the **+** button in the Photos panel.
2. Drop your image file (JPEG, PNG, WEBP, TIFF).
3. Choose a plate-solving method:
   - **Online (astrometry.net)** — no local software needed, just an API key. Takes 30–60 seconds.
   - **ASTAP (local)** — fastest (3–5 sec) but requires [installation](/user/installing-solvers.md). Works on Windows, macOS, Linux.
   - **Manual** — drag the photo onto the map and align it yourself.

---

## Choosing a plate-solving method

| Situation                               | Best method                              |
| --------------------------------------- | ---------------------------------------- |
| FITS file from your processing software | **WCS metadata** — instant, no setup     |
| JPEG/PNG, first time using the app      | **Online (astrometry.net)** — no install |
| You've installed ASTAP                  | **ASTAP** — fastest, works offline       |
| Solving keeps failing                   | **Manual placement** — always works      |

> **Tip for ASTAP:** Type the object name (`M31`, `NGC 7000`, `Orion Nebula`) in the "Target object" field before solving. This dramatically improves reliability.

---

## Navigating the sky map

| Action                   | How                                  |
| ------------------------ | ------------------------------------ |
| Pan                      | Click and drag                       |
| Zoom                     | Mouse wheel                          |
| Jump to an object        | Type its name in the Search box      |
| Switch to Gallery        | Click **Gallery** in the top nav bar |
| Open the Targets planner | Click **Targets** in the top nav bar |

---

## Next steps

- [Installing MyAstroSky](/user/installing-app.md) — desktop app, self-hosting, or LAN sharing
- [Features Reference](/user/user-guide.md) — complete guide to every feature
- [Installing Plate Solvers](/user/installing-solvers.md) — set up ASTAP or solve-field for offline solving
- [Troubleshooting](/user/troubleshooting.md) — if something isn't working
