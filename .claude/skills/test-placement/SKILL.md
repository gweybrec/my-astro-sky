---
name: test-placement
description: >
  Test astrophoto placement and plate solving on the sky map. Use when uploading a
  photo, running plate solving (solve-field or ASTAP), verifying placement alignment,
  or debugging a misaligned or failed solve. Covers the full upload-solve-place-verify
  workflow using Playwright browser tools.
  Trigger phrases: "test placement", "test photo", "upload photo", "plate solve",
  "verify placement", "check alignment", "photo on map", "place on map".
---

# Test Photo Placement

This skill guides you through uploading and verifying an astrophoto placement on the sky map.

## Unit tests

This skill covers browser-based manual verification only. It does not modify source code, so no unit tests apply.

---

## Source folder

All astro photos live in `astro-photos/` (relative to the repository root). If the user names a specific file, use that. Otherwise list the folder and pick one that isn't already in the photo list on the map.

**Only `.jpg` / `.jpeg` / `.png` files can be added as photos.** `.fit`, `.fits`, `.tif`, and `.tiff` files are raw/calibration files used only as WCS metadata companions (via the "Metadata (FITS/TIFF)…" button inside the modal) — never pass them to the file chooser when adding a photo.

## Step 0 — Make sure the app is running

Check `http://localhost:5173/` with `browser_navigate`. If it doesn't load, run `npm run dev` in the background first.

## Step 1 — Open the upload modal

Click the "+ Add a photo" button (`button[ref]` labeled "+ Add a photo" in the snapshot). This queues a file chooser in Playwright — handle it immediately with `browser_file_upload` and the absolute path to the chosen image. **Never click the button more than once without immediately calling `browser_file_upload`** — extra clicks stack queued file choosers that block the UI.

## Step 2 — Plate-solve the image

In the upload modal, use the **solve-field** button first (local solver, best results). Wait for the solve to complete — it may take 30–60 seconds. Watch for the correspondences to appear in the modal.

**Do NOT use the online astrometry.net submit option** unless the user explicitly asks. It uploads the full image to astrometry.net. The only acceptable online option without asking is "Reuse online solution" (which reuses an existing job ID without uploading).

If solve-field fails, try **ASTAP** next. If both fail, ask the user for hints (target name, RA/Dec, FOV) and retry with those.

## Step 3 — Place on map

Click "Place on map". The modal closes and the photo should appear on the canvas. After the `onload` event fires (usually instant), the photo transform is applied.

## Step 4 — Immediate visual check (Playwright)

Take a screenshot or snapshot right after placement. Look for:

- **Thin line / streak across the sky**: means the affine fit collapsed — correspondences have bad RA/Dec. This is the known bug fixed in `getCorrRaDec` (`!= null` check). If it happens again, report it.
- **Photo off-screen or at a random position**: affine fit may have used wrong stars.
- **Photo visible and roughly in the right region**: proceed to zoom check.

## Step 5 — Zoom in and compare

Use the sky map's pan/zoom (scroll wheel / drag) to center the photo on the canvas. Or use the sidebar to click the photo name — it should pan to the photo location.

Zoom in until:
- Individual stars in the photo are visible and can be compared to catalog stars on the canvas.
- DSO placeholders (ellipses/circles for nebulae, galaxies, clusters) align with the bright regions in the photo.

Key checks:
- **Messier / NGC / IC objects**: find the DSO label on the map, confirm it sits on the corresponding bright region in the photo.
- **Named stars**: e.g. Tejat, Elnath, Betelgeuse — they should sit exactly on the bright star in the photo.
- **Rotation**: the orientation of bright nebulae or galaxy shapes should match the map's orientation at that zoom.

## Step 6 — Sanity checks

- **Stars solved far from the hint**: if the user gave a hint (e.g. "M31") and the photo landed in Orion, the solve is wrong. Delete and retry with more specific hints.
- **Mirror/flip**: if the photo is mirrored, the stars will be offset systematically on one side. Visible as a diverging pattern when comparing east vs west edges.
- **Scale mismatch**: photo looks correct in center but stars diverge toward edges → the WCS scale or the affine fit is off. Check how many correspondences were used (more = better).
- **Constellation sanity**: know the target. IC443 is in Gemini near Tejat (μ Gem). M31 is in Andromeda. M42 is in Orion. If the photo lands in the wrong constellation, something is wrong.

## Step 7 — Toggle visibility

Use the eye icon (👁) next to the photo in the sidebar to hide/show it. Confirm the underlying DSO placeholders match the photo content when toggled off.

## Step 8 — Check browser console

Call `browser_console_messages` and check for errors or warnings introduced by the placement. Ignore pre-existing errors.

## Step 9 — Report result

Summarize:
- Which file was placed.
- Which solver succeeded.
- What DSO/star anchors were checked and whether they aligned.
- Any issues found (and fixed if applicable).
