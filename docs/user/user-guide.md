# Features Reference

MyAstroSky overlays your astrophotographs onto an interactive sky map using automatic plate solving. Photos are positioned with mathematically correct rotation, scale, and position.

> **New to the app?** Start with [Getting Started](getting-started.md) first.

---

## Table of Contents

- [Interface overview](#interface-overview)
- [Uploading and placing a photo](#uploading-and-placing-a-photo)
- [Plate solving methods](#plate-solving-methods)
- [Manual placement](#manual-placement)
- [Repositioning an existing photo](#repositioning-an-existing-photo)
- [Photo organization](#photo-organization)
- [Gallery mode](#gallery-mode)
- [Targets tab](#targets-tab)
- [Observing plans](#observing-plans)
- [Search](#search)
- [Display settings](#display-settings)
- [Desktop error logs](#desktop-error-logs)

---

## Interface overview

The app has three main views, toggled from the top navigation bar:

- **Map** — Interactive sky map (stereographic polar projection). Pan with click-and-drag, zoom with the mouse wheel. Your photos are overlaid directly on the map.
- **Gallery** — Grid of all uploaded photos. Click a photo to jump to its location on the map.
- **Targets** — Recommends DSOs (deep sky objects) based on your gear, location, and the current date.

A collapsible side panel on the right holds Photos, Search, DSO info, Display settings, and app Settings.

---

## Uploading and placing a photo

1. Click the **+** button in the Photos section of the side panel.
2. Drop your image or use the file picker. Supported formats: JPEG, PNG, WEBP, TIFF, FITS. Max size: 200 MB.
3. Choose a plate-solving method (see below) or place the photo manually.
4. Once solved or placed, the photo appears on the map at the correct position.

---

## Plate solving methods

### 1. Metadata (WCS) — instant

Reads WCS calibration data already embedded in the file (FITS files from PixInsight, Siril, Astro Pixel Processor, etc.). Takes 0 seconds — no computation needed.

Use this whenever your file already has astrometric metadata.

### 2. Online (astrometry.net) — most reliable

Uploads the image to [nova.astrometry.net](https://nova.astrometry.net) for solving. Requires a free API key configured in Settings. Typically takes 30–60 seconds.

Best choice if you don't have a local solver installed and don't mind cloud upload. See [Installing Plate Solvers](installing-solvers.md) for API key setup.

### 3. solve-field (local) — most accurate

**Linux only.** Uses the astrometry.net algorithms locally. Gives the best accuracy for heavily processed or stretched images. Takes 10–30 seconds. On Windows the option is automatically disabled — use ASTAP or online solving instead.

See [Installing Plate Solvers](installing-solvers.md) for setup instructions.

### 4. ASTAP (local) — fastest

Professional local solver. Works on Linux, macOS, and **Windows**. Solves in ~3–5 seconds. Works best when you provide a target object hint (type the object name in the "Target object" field before solving).

**Position hints** (recommended): type the object name — `M31`, `NGC 7000`, `Andromeda` — in the "Target object" field. This dramatically improves reliability.

See [Installing Plate Solvers](installing-solvers.md) for setup instructions.

---

## Manual placement

If automatic solving fails or you prefer manual control, use one of these methods from the upload modal:

- **3-point registration**: Click 3 points on the photo, then identify each corresponding star on the map (by name search or direct map click). Computes a full affine transform (rotation, scale, position, shear).
- **2-point registration**: Same as above with 2 points. Computes a similarity transform (rotation, uniform scale, position — no shear).
- **Drag-and-drop**: Drag the photo onto the map, then adjust with the rotation slider, zoom slider, and mirror toggles.

---

## Repositioning an existing photo

Click the gear icon on any photo in the side panel, then **Reposition**. This re-opens manual placement controls with the photo's current position pre-loaded. You can adjust rotation, scale, position, and mirroring without re-uploading the file.

---

## Photo organization

- **Visibility**: Toggle individual photos on/off with the eye icon.
- **Order**: Drag to reorder photos. The bottom of the list renders on top.
- **Opacity**: Set per-photo opacity (0–100%) via the gear popup slider.
- **Deletion**: Deleted photos have a 5-second undo window via the toast notification.

---

## Gallery mode

Displays all photos in a grid. Click any photo to switch to Map mode and center on that photo. Photos are sorted in natural order (M1, M8, M31, M100, M101…).

---

## Targets tab

Recommends DSOs to photograph based on your gear, location, date, and object filters. Click any suggestion to navigate directly to it on the sky map.

### Gear selection

The gear section has three separate dropdowns:

- **Telescope** — choose from the built-in catalog or a custom entry you added. The field of view (FOV) and recommended targets are computed from the telescope's focal length and aperture.
- **Camera** — choose the sensor attached to the telescope. Used to compute FOV and pixel scale.
- **Accessory** — optional. Select a focal reducer, barlow, or field flattener to adjust the effective focal length. Choose *None (no accessory)* to use the telescope's native focal length.

The **ℹ** icon next to each dropdown shows a popup with the selected item's key specifications (sensor size, focal length, magnification factor, etc.).

A live hint below the three dropdowns shows the computed **effective focal length**, **FOV**, and **pixel scale** for the current selection.

#### Smart telescopes

For integrated (smart) telescopes such as the Seestar S50 or Vespera, the camera and accessory dropdowns are locked — these instruments have a fixed, built-in sensor and cannot accept external accessories. The effective focal length and FOV are computed automatically from the integrated optics.

### Filters

Below the gear section you can narrow down which objects are recommended:

| Filter | Description |
|---|---|
| **Observing location** | Latitude and longitude. Click *Use my location* for automatic geolocation, or type coordinates manually (decimal or DMS). |
| **Date** | Night to plan for. Defaults to today. |
| **Object types** | Toggle which DSO categories are included (spiral galaxy, elliptical galaxy, open cluster, globular cluster, emission nebula, reflection nebula, planetary nebula, supernova remnant, dark nebula). |
| **Horizon** | Block objects that will be above the N/S/E/W horizon during the night — useful if a wall or mountain obstructs part of your sky. |
| **DSO interest** | Filter by interest rating (1–5 stars, as assigned in the catalog). |
| **Difficulty** | Filter by imaging difficulty (1–5 diamonds). |
| **Catalogs** | Limit results to specific catalogs (Messier, NGC, IC, Sharpless 2, …). |
| **Include oversized objects** | When enabled, objects whose angular size significantly exceeds the FOV are included in results (they score lower by default). |

### Generating recommendations

Click **Best** to show the highest-scoring objects for your gear and location — ranked by a combination of imaging interest, altitude, transit time, FOV fit, and difficulty match.

Click **Random** to explore a shuffled selection from the same pool, useful for finding less obvious targets.

Results show for each object:

- Name and catalog identifier(s)
- DSO type and constellation
- Maximum altitude during the night
- Best imaging time (local time of transit)
- Magnitude, angular size, difficulty, and interest rating
- Overall score and FOV-fit percentage
- Suggested imaging recipe (total integration time and filter breakdown)

Use the **sort** dropdown to reorder results by score, altitude, transit time, magnitude, size, FOV fit, name, rating, or difficulty. Use the **per-page** selector and pagination controls to browse through the full result set.

Click **Open on map** on any card to jump to that object's position on the sky map.

### Adding custom gear

If your telescope, camera, or accessory is not in the built-in catalog, click **+ Add telescope**, **+ Add camera**, or **+ Add accessory** beneath the corresponding dropdown.

A modal opens with a form:

- **Required fields** are marked with `*` and must be filled in — these are the values needed to compute FOV and pixel scale (aperture, focal length, sensor dimensions, pixel size, magnification factor).
- **Optional fields** (optical design, mount interface, notes, thread specifications) can be left blank.
- Each field has an **ℹ** icon that explains what value is expected, with an example from an existing catalog item.
- If you try to save with a required field empty, that field is highlighted in red with a *Required* message.

Once saved, the new item appears immediately at the bottom of the relevant dropdown and is selected automatically.

Custom gear is stored on the server (in the app database) and persists across sessions. It can be exported together with your other data via **Settings → Export → Custom telescopes/cameras/accessories**.

---

## Observing plans

Observing plans let you build a target list for a specific night, linked to a gear setup. Plans are accessible from the **Cibles & Plans / Targets** view via the **My plans** tab.

### Creating a plan

Click **+ New plan** in the My plans tab. A plan is named after the night by default (e.g. *Night of 2026-06-17*) and can be renamed at any time with the pencil icon.

Each plan has two optional settings, editable from the plan header:

- **Night** — the observation date used to compute transit times and altitude curves.
- **Setup** — the gear setup (telescope + camera + accessory) used to size the FOV frames on the map.

### Adding targets

Targets can be added to a plan from two places:

- **Suggestions tab** — click the bookmark icon on any recommendation card and choose a plan (or create a new one).
- **Search results** — open a DSO info panel from the search box and use the same bookmark button.

Each plan entry shows the object name, type, transit time, and a link to open it on the map.

### Viewing a plan on the map

When a plan has a gear setup configured, each entry is represented as a **FOV frame** on the sky map — a rectangle sized to the telescope/camera field of view, centered on the target. Frames are visible in the Map view and can be dragged, rotated, and pinned.

Use the **Show on map / Hide from map** toggle in the plan header to show or hide all frames at once.

### Reordering and removing entries

Drag entries to reorder them within a plan. Click the × button on an entry to remove it from the plan (the DSO itself is not deleted).

### Exporting a plan

Click **Export as PDF** in the plan header to generate a printable observation sheet with the target list, transit times, and FOV sketches.

---

## Search

The search box at the top of the side panel searches both stars and DSOs in real time.

**Stars**: proper names (Vega, Betelgeuse), Bayer (α Lyr, "alpha lyr"), Flamsteed (47 UMa), catalog IDs (HD 12345, HIP 91262).

**DSOs**: catalog IDs (M31, NGC 7000, IC 1805, SH2-106), common names (Andromeda Galaxy, Orion Nebula).

Click a result to navigate to it on the map. The info panel shows object details and nearby bright stars.

---

## Display settings

All settings are saved in the browser and persist across sessions.

**Toggles**: stars, DSOs, constellation lines, constellation names, star labels, DSO labels, coordinate grid, photo outlines, star tooltips, DSO tooltips.

**Sliders**:
- Magnitude limit (6–11 or ∞, with auto-adjust by zoom level)
- Max star count / max DSO count
- Sky opacity, background gradient opacity
- Default photo opacity for new uploads

**Filters**: DSO type (Gx, OC, GC, EN, RN, PN, SNR, DN) and catalog (Messier, NGC, IC, Sharpless).

---

## Desktop error logs

If you use the Electron desktop app and an error occurs (for example an error toast, an API/solver failure, or an unexpected runtime error), MyAstroSky writes a local diagnostics file automatically.

- One JSON file is created per error event
- Files are timestamped and stored in a logs folder in your app data directory
- Old logs are automatically deleted after 30 days

Default log folder locations:

- **Linux**: `~/.config/MyAstroSky/logs/`
- **Windows**: `%APPDATA%\MyAstroSky\logs\`

Important limitation (expected behavior):

- In **browser mode** (hosted URL, Docker, or Node.js web app), **Open logs folder** is intentionally unavailable.
- This is **not a bug**: opening a local OS folder requires Electron desktop APIs that do not exist in a normal web browser.
- In browser mode, use browser developer tools/console logs for diagnostics.

When reporting a bug, attach the most recent `my-astro-sky-error-*.json` file.
