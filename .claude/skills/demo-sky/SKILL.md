---
name: demo-sky
description: >
  Build or extend the demo shared sky: a .myastrosky package of freely licensed Wikimedia Commons
  photos of well-known DSOs, each plate-solved locally with solve-field, credited to its author and
  carrying what its Commons page states (exposures, gear, date). Covers choosing targets, fetching
  candidates, solving, the visual and license review, reading the pages, and building a new version.
  Trigger phrases: "demo sky", "new version of the demo sky", "add objects to the demo sky",
  "Wikimedia sky", "shareable demo sky", "demo .myastrosky".
---

# The demo shared sky

A shared sky (`docs/dev/shared-sky.md`) made of other people's photos from Wikimedia Commons, meant to be
shared as a file. It is **not** part of the app: nothing goes into `public/` or the app's data. The scripts
are in `scripts/` next to this file; everything they download or write goes to a **working folder** the
user names.

## Rules that never bend

- **Free licenses only:** public domain, CC0, CC BY, CC BY-SA. No NC, no ND, no "free for private use".
- **No text burned into the picture:** no labels, arrows, titles, captions, inset close-ups or info boxes.
  The app draws its own DSO overlay. A small signature or logo in a corner is allowed.
- **Photographs only:** no planetarium-software renderings, simulations, charts or annotated versions.
- **Plate-solved locally** (solve-field): never upload anything to astrometry.net (root `CLAUDE.md`).
- **Only what the page states:** never guess an exposure, a gear item or a date.
- **Wider photos below smaller ones:** the order of the photos in the package is their draw order once opened
  (the first is drawn at the bottom, the last on top), and a visitor cannot reorder them. So the package lists
  the photos from the widest field to the smallest: a small photo inside a wide one (M42 in the Barnard's Loop
  field) stays visible on top of it instead of being hidden under it. `build-package.mts` sorts by `fieldDeg`;
  never write the photos in solve or target order.
- **A built version is never overwritten**, and every version keeps the same sky id (`sky.json`), so a visitor
  who opens a newer one gets it as an update of the same visit.
- The working folder, the solver and its index files stay **outside the repository**. Never write a path of
  anyone's machine into this skill or its scripts.

## Setup (ask the user for anything missing)

| Variable                  | What                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `DEMO_SKY_DIR`            | The working folder: outside the repository, or git-ignored. **Required.** Ask for it.   |
| `SOLVE_FIELD_PATH`        | The solve-field command (default `solve-field`), as the app's setting of the same name. |
| `USE_WSL_FOR_SOLVE_FIELD` | `1` on Windows to run solve-field inside WSL, as the app's setting of the same name.    |
| `SOLVE_FIELD_INDEX_DIRS`  | Extra index folders, as the **solver** sees them, separated by `;`.                     |
| `WIKIMEDIA_CONTACT`       | Contact in the User-Agent. Default: the repository's `https` remote.                    |

- **Index files.** solve-field needs index files covering fields from about 0.5° upwards: the 4107–4115
  series and the 4206 series or wider (often a distribution package). The **4205** series (12 files, about
  650 MB, `https://data.astrometry.net/4200/index-4205-NN.fits`) is worth adding for fields under 1°; put it
  in a folder of the user's choice and name it in `SOLVE_FIELD_INDEX_DIRS`.
- **Git Bash on Windows** rewrites a `/home/…` value into a Windows path before Python sees it: also set
  `MSYS2_ENV_CONV_EXCL=SOLVE_FIELD_INDEX_DIRS`, or set the variables from PowerShell.
- **Wikimedia** blocks automated requests whose User-Agent has no contact; the default contact is the
  project's public repository address, read from the git remote at run time.
- Python with Pillow; run every script with `python -P -E -X utf8` (`-P` keeps downloaded files off the import
  path, `-X utf8` keeps file names with accents from crashing the output).

## The working folder

| File / folder                                | Written by                | Content                                                                       |
| -------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `sky.json`                                   | you, once                 | `{ "skyId": "<uuid>", "senderName": "MyAstroSky demo · Wikimedia Commons" }`  |
| `targets.json`                               | you                       | `[ ["M42", "Orion Nebula"], ... ]`: catalog id, English article; wanted first |
| `candidates.json`                            | `fetch_candidates.py`     | Top 5 free Commons files per target                                           |
| `solved.json`                                | `solve.py`, `review.py`   | Kept photos (all versions), failed objects, rejected files                    |
| `details.json`                               | `details.py fetch`        | Each kept photo's Commons page: author, license, wikitext                     |
| `entries.json`                               | you, by reading the pages | What each page states (format below)                                          |
| `images/`, `solve/`, `downloads/`, `review/` | the scripts               | Pictures as stored, solutions, raw downloads, contact sheets                  |

`solved.json` holds **every** kept photo of every version: a new version adds to it. Before starting a new
version, copy `solved.json` and `entries.json` aside (`solved-v2.json`…) so the previous one can be traced.

## Steps

Scripts live in `.claude/skills/demo-sky/scripts/`; run the Python ones with `python -P -E -X utf8 <script>`.

1. **Targets.** Add objects to `targets.json`, chosen from what the user asks for: a theme ("a galaxy demo
   sky", "only planetary nebulae", "the southern sky") or, when nothing is said, a varied mix (nebulae of
   each kind, planetary nebulae, SNRs, open and globular clusters, galaxies of each shape, both
   hemispheres). The `type` field of `public/data/dso.json` picks objects of a kind: `GxS` spiral, `GxE`
   elliptical, `GxI` irregular, `Gx` other galaxy, `EN` emission, `RN` reflection, `DN` dark nebula, `PN`
   planetary nebula, `SNR`, `OC` open cluster, `GC` globular cluster; its `rating` favours well-known
   objects. Check every id exists there (its `id` or one of its `catalogs`; use the `id`). **List the
   objects in the order they are wanted**: `solve.py` tries them in that order and stops at the total, so
   a mix must be interleaved, not grouped by kind. Skip objects already inside an existing photo (M32 in
   M31, M65 in the Leo Triplet). Add about 1.7× the number of photos wanted: many will fail or be rejected.
2. **Candidates:** `fetch_candidates.py`. Commons category from Wikidata, else a designation category
   (`Messier 81`, `NGC 281`, `Sh2-155`…). A category holding only sub-categories gives no candidate.
3. **Solve:** `solve.py <total>`, in the background, `<total>` = photos already kept + new ones wanted +
   ~10 % for rejects. Four solves at a time, each stopped after 5 minutes (a hinted solve succeeds in
   seconds). It is resumable. Give the user a progress line about every 30 minutes on long runs.
   **The number asked for is a target, not a limit:** solves already running when it is reached finish,
   so a few more photos may come in. Keep them; drop solved photos to hit an exact count only when the
   user asks for exactly that many.
4. **Look at every new picture:** `review.py sheet`, then read each sheet image. Per photo:
   - text, labels, insets, captions → `review.py reject ID "text"` (another image of the object is tried);
   - black padding, rotated frame with empty corners, satellite trail, nearly empty or vignetted frame →
     `reject`;
   - the object is already in another photo, or every image of it has a problem → `review.py drop ID "why"`.
     Then run `solve.py <total>` again for the replacements and look at those too. Never run `review.py`
     while `solve.py` is running.
5. **Read the pages:** `details.py fetch`, then `details.py show` (the photos without an entry). For each:
   - **License traps → reject or drop:** a CC0/PD tag on a picture whose text says "all rights reserved",
     "copyright …", or credits a team of several photographers; "free for private use / promotion only";
     a page that says it was rendered by planetarium or simulation software (and other uploads of the same
     source that look rendered).
   - **Author:** the photographer as the page names them (a "Photo by X" line beats the uploader's account);
     a duo as "A, B"; at most 60 characters.
   - Write the entry in `entries.json`.
6. **Build:** from the repository root,
   `DEMO_SKY_DIR=… npx tsx .claude/skills/demo-sky/scripts/build-package.mts v3`. It refuses to run while a
   kept photo has no entry or no fetched page, writes the photos widest field first (see the rules), and
   checks the package with the app's own parser. The file name uses keyboard characters only:
   `MyAstroSky demo - Wikimedia Commons v3.myastrosky`.
7. **Check in the app:** start the dev server, `POST /api/shared-skies/inspect` the package (field `bundle`)
   then `POST /api/shared-skies/open/<ticket>`; all photos must import with 9 reference points and an author.
   Show only that sky, zoom on a few photos and check them against the catalog outlines. Zoom also on a wide
   field holding smaller photos (Barnard's Loop, the Gamma Cygni region): the smaller ones must show on top of
   it, and `GET /api/shared-skies/<skyId>/photos` must list the widest first. Afterwards delete
   the visit (`DELETE /api/shared-skies/<skyId>`) and stop the server you started.
8. **Hand over** the package and `CREDITS-<label>.html` (the attribution list to share with it), with the
   objects added, those dropped and why.

## `entries.json`

```json
{
  "M31": {
    "objectName": "Andromeda Galaxy (M31)",
    "author": "Starhopper",
    "date": "2015-08-08",
    "integrations": [
      { "frames": 57, "seconds": 300, "filter": "L" },
      { "frames": 18, "seconds": 300, "filter": "R" }
    ],
    "gear": {
      "telescope": "Skywatcher Esprit 100/550",
      "camera": "SBIG STL-11000M",
      "accessory": "EQ6R-PRO mount"
    },
    "captureDetails": { "setTemp": -20, "gain": 75, "offset": 15, "iso": 800, "binning": "2x2" },
    "note": "Anything else worth a line: site, palette, a comet in the field."
  }
}
```

- `objectName` is shown as the photo's name on the map and in the gallery: name the objects in the frame.
- `date`: the capture date the page gives (`YYYY-MM-DD`, stored as midnight UTC), else `null`. A Flickr
  "taken on" or an upload or release date is not a capture date unless nothing else is given and it is
  plausible; a range ("18 to 29 June") is `null` with the range in `note`.
- `integrations`: frames × seconds per filter as stated. A total only ("12.9 h") is one row
  `{ "frames": 1, "seconds": <total s> }`. Frames without a length: `{ "frames": N, "seconds": 0 }`. A filter
  without exposures: `{ "frames": 0, "seconds": 0, "filter": "…" }`.
- `captureDetails`: only `gain`, `offset`, `iso`, `ccdTemp`, `setTemp`, `binning` (`packages/core/src/capture-fields.ts`).
- The license, its link and the source page come from `details.json`; the build writes them into the notes.

## What is kept from past runs

- `solve.py` rules: centre within max(0.5°, 30 % of the field) of the catalog position, CD skew under 5°
  (`server/astap.ts`), field between 0.5° and max(3°, 10 × the object's size); objects under 2′ get only
  their 2 best images. Pictures are stored upright, at most 4000 px, without EXIF, so `fitsYConvention` is
  `false` and no orientation correction applies.
- A solve stopped from outside keeps running inside WSL: `run_solver` stops it there with `timeout`.
- Tiny planetary nebulae (Eskimo, Saturn, Blue Snowball…) rarely give a wide enough solvable image.
- Photo ids are made at each build; a visitor's app replaces the visit's photos on an update, so this is fine.
