# Mobile spikes — results and decisions

Date 2026-10-03, branch `spike/mobile` (throwaway, never merged), commits `1351fa5` (spike app), `514a3c6`, `7054a36`, `5cb847d` (measurements).

All values below are copied as they appear in the result files in `spikes/mobile/results/` on that branch.

## Device

From `device.json`.

| Field                   | Value                                             |
| ----------------------- | ------------------------------------------------- |
| Serial                  | R58Y90H5QPX                                       |
| Manufacturer            | samsung                                           |
| Model                   | SM-A165F (device `a16`)                           |
| Android release         | 16                                                |
| SDK                     | 36                                                |
| ABI                     | arm64-v8a                                         |
| Total memory            | 3740844 kB (`memTotalKB`)                         |
| WebView package         | com.google.android.webview                        |
| WebView version         | 153.0.8010.36 (versionCode 801003603)             |
| WebView system image    | 143.0.7499.192                                    |
| WebView source          | `dumpsys webviewupdate` (current WebView package) |
| Chrome package, version | com.android.chrome, 153.0.8010.52                 |

## Toolchain used

- Capacitor 8.5.2 (core, cli, android)
- `@capacitor-community/sqlite` 8.1.1
- `@capawesome/capacitor-file-picker` 8.1.0
- AGP 8.13.0, Gradle 8.14.3
- build-tools 37.0.0, pinned for all modules through a `subprojects` block in `android/build.gradle`, because 35.0.0 is not installed and nothing may be installed
- compileSdk and targetSdk 36, minSdk 24
- `android.builder.sdkDownload=false`

## Results

### Performance (sky map in the real app)

Source: `perf-app.json`. Origin `https://localhost`, started 2026-10-03T12:57:06.714Z. Drag and wheel zoom used synthetic mouse and wheel events through the existing handlers.

| Measurement                             | Value              | Unit  | Notes                             |
| --------------------------------------- | ------------------ | ----- | --------------------------------- |
| Wall clock to first sky draw            | 1839               | ms    | `wallClockToFirstSkyDrawMs`       |
| First contentful paint (`fcp`)          | 556                | ms    | `marks.fcp`                       |
| First sky draw                          | 1717.2000000178814 | ms    | `marks.firstSkyDraw`              |
| Long tasks, total duration              | 1039               | ms    | `marks.longTaskMs`                |
| Long tasks, count                       | 5                  | count | `marks.longTasks`                 |
| Long tasks after settle, total duration | 1948               | ms    | `marksAfterSettle.longTaskMs`     |
| Long tasks after settle, count          | 16                 | count | `marksAfterSettle.longTasks`      |
| Overlay removed                         | 2370.100000023842  | ms    | `marksAfterSettle.overlayRemoved` |
| JS heap used after load                 | 54.4               | MB    | `heapAfterLoad.jsHeapUsedMB`      |
| JS heap total after load                | 75.6               | MB    | `heapAfterLoad.jsHeapTotalMB`     |
| DOM nodes after load                    | 752                | count | `heapAfterLoad.nodes`             |

Star catalog fetch and parse (`starsJson`, three runs on the same 15377672-byte file, 2 keys):

| Run | Bytes    | Fetch (ms) | `JSON.parse` (ms) |
| --- | -------- | ---------- | ----------------- |
| 1   | 15377672 | 250.2      | 170.6             |
| 2   | 15377672 | 195.5      | 178.7             |
| 3   | 15377672 | 278.6      | 190.2             |

Interaction:

| Measurement             | Drag (`drag`) | Wheel zoom (`wheelZoom`) | Unit  | Notes                  |
| ----------------------- | ------------- | ------------------------ | ----- | ---------------------- |
| Frames                  | 349           | 395                      | count |                        |
| Duration                | 5078          | 5000                     | ms    |                        |
| Frame rate              | 68.7          | 79                       | fps   |                        |
| Frame time p50          | 11.1          | 11.1                     | ms    |                        |
| Frame time p95          | 22.4          | 22.3                     | ms    |                        |
| Frame time max          | 99.8          | 55.6                     | ms    |                        |
| Frames over 25 ms       | 16            | 17                       | count |                        |
| Input events            | 177           | 186                      | count |                        |
| Input events per second | 35.4          | 37.2                     | 1/s   |                        |
| Script duration delta   | 0.617         | 0.062                    | s     | `scriptDurationDeltaS` |
| Task duration delta     | 1.898         | 0.903                    | s     | `taskDurationDeltaS`   |
| JS heap used after      | 50.7          | 50.8                     | MB    | `jsHeapUsedMBAfter`    |

### Photo layer (20 `ImageBitmap`s on a canvas)

Sources: `perf-photos.json` (real photos picked on the phone, started 2026-10-03T13:06:49.164Z) and `perf-photos-synthetic.json` (synthetic images, started 2026-10-03T12:57:30.500Z). Both are `autoSetup: true`, 20 bitmaps, distinct copies. Pixel memory of an `ImageBitmap` is native/GPU and not in the JS heap (note in both files).

| Measurement                  | Real photos          | Synthetic         | Unit  | Notes                              |
| ---------------------------- | -------------------- | ----------------- | ----- | ---------------------------------- |
| Source files                 | M26.jpg, LDN1235.jpg | synthetic-1 to -4 |       | `sourceNames`                      |
| Bitmaps                      | 20                   | 20                | count |                                    |
| Bitmap size                  | 2048x1102            | 2048x1536         | px    | `bitmapSize`                       |
| Decode of sources            | 804                  | 54                | ms    | `decodeSourcesMs`                  |
| Copies                       | 19                   | 60                | ms    | `copiesMs`                         |
| JS heap before / after setup | 68.9 / 68.9          | 68.9 / 68.9       | MB    | `jsHeapMBBefore` / `jsHeapMBAfter` |
| JS heap limit                | 954                  | 954               | MB    | `jsHeapLimitMB`                    |
| JS heap used after setup     | 7                    | 3.9               | MB    | `afterSetup.jsHeapUsedMB`          |
| DOM nodes after setup        | 59                   | 58                | count | `afterSetup.nodes`                 |

Pan and pinch (`pan`, `pinch`):

| Measurement             | Real, pan | Real, pinch | Synthetic, pan | Synthetic, pinch | Unit  | Notes                |
| ----------------------- | --------- | ----------- | -------------- | ---------------- | ----- | -------------------- |
| Frames                  | 453       | 448         | 458            | 453              | count |                      |
| Duration                | 5034      | 5056        | 5100           | 5056             | ms    |                      |
| Frame rate              | 90        | 88.6        | 89.8           | 89.6             | fps   |                      |
| Frame time p50          | 11.1      | 11.1        | 11.1           | 11.1             | ms    |                      |
| Frame time p95          | 11.2      | 11.2        | 11.2           | 11.2             | ms    |                      |
| Frame time max          | 11.3      | 55.6        | 22.2           | 33.3             | ms    |                      |
| Frames over 25 ms       | 0         | 2           | 0              | 1                | count |                      |
| JS draw time, mean      | 0.35      | 0.34        | 1.23           | 0.75             | ms    | `jsDrawMsMean`       |
| JS draw time, p95       | 0.8       | 1           | 2.5            | 2                | ms    | `jsDrawMsP95`        |
| Bitmaps drawn           | 20        | 20          | 20             | 20               | count |                      |
| Input events            | 215       | 205         | 223            | 214              | count |                      |
| Input events per second | 43        | 41          | 44.6           | 42.8             | 1/s   |                      |
| Task duration delta     | 1.165     | 1.198       | 1.84           | 1.366            | s     | `taskDurationDeltaS` |
| JS heap used after      | 7.7       | 7.8         | 5.4            | 4.7              | MB    | `jsHeapUsedMBAfter`  |

Final view after pinch (`finalView`): real `tx` -241.1966485977175, `ty` -308.2219851470586, `scale` 0.26038468809688814; synthetic `tx` -248.40848426818815, `ty` -317.37356152854034, `scale` 0.2648219929863424.

### SQLite (`@capacitor-community/sqlite`)

Source: `sqlite.json`, collected 2026-10-03T13:02:43.487Z. 500 photos, 15 correspondences per photo, database `spike_1791032281103` (deleted at the end, `deleted: true`).

| Measurement                                     | Value  | Unit  | Notes                                                                       |
| ----------------------------------------------- | ------ | ----- | --------------------------------------------------------------------------- |
| Database open                                   | 129    | ms    | `openMs`                                                                    |
| Migrations, final version                       | 14     | n/a   | `migrations.finalVersion`                                                   |
| Migrations, statements run                      | 16     | count | `migrations.statementsRun`                                                  |
| Migrations, tolerated failures                  | 11     | count | Listed below                                                                |
| Migrations, time                                | 1399   | ms    | `migrations.ms`                                                             |
| Schema total                                    | 1758   | ms    | `schemaTotalMs`                                                             |
| Tables created                                  | 14     | count | Listed below                                                                |
| `PRAGMA foreign_keys` before / after the pragma | 1 / 1  | n/a   | `foreignKeysBeforePragma` / `foreignKeysAfterPragma`                        |
| Cascade delete check                            | ok     | n/a   | correspondences 3 before, 0 after                                           |
| Null binding                                    | ok     | n/a   | `runOk`, `executeSetOk`, `jsValuesAreNull` all true; read back as JS `null` |
| Individual `run()`, photos                      | 500    | count | `individualRun.photos`                                                      |
| Individual `run()`, correspondences inserted    | 7500   | count | 7500 planned, `aborted: false`                                              |
| Individual `run()`, photos time                 | 16550  | ms    | `photosMs`                                                                  |
| Individual `run()`, correspondences time        | 259999 | ms    | `correspondencesMs`                                                         |
| Individual `run()`, total time                  | 276549 | ms    | `totalMs`                                                                   |
| Individual `run()`, per call                    | 34.57  | ms    | `msPerRun`                                                                  |
| Delete all with cascade                         | 77     | ms    | `deleteAllCascadeMs`; 0 correspondences left                                |
| One `executeSet`, statements                    | 8000   | count | 500 photos + 7500 correspondences                                           |
| One `executeSet`, time                          | 2364   | ms    | `executeSet.ms`                                                             |
| Read all, photo rows                            | 500    | count | `readAll.photoRows`                                                         |
| Read all, correspondence rows                   | 7500   | count | `readAll.correspondenceRows`                                                |
| Read all, time                                  | 590    | ms    | `readAll.ms`                                                                |

Tolerated migration failures (replaying the desktop schema history in its original order), as recorded:

- v1: `ALTER TABLE star_correspondences ADD COLUMN star_ra REAL` (duplicate column name: star_ra)
- v1: `ALTER TABLE star_correspondences ADD COLUMN star_dec REAL` (duplicate column name: star_dec)
- v2: `ALTER TABLE plans ADD COLUMN night_of TEXT` (no such table: plans)
- v2: `ALTER TABLE plans ADD COLUMN setup_id TEXT` (no such table: plans)
- v4: `ALTER TABLE plan_entries ADD COLUMN mosaic_id TEXT` (no such table: plan_entries)
- v6: `ALTER TABLE plan_entries ADD COLUMN mosaic_w_deg REAL` (no such table: plan_entries)
- v6: `ALTER TABLE plan_entries ADD COLUMN mosaic_h_deg REAL` (no such table: plan_entries)
- v7: `ALTER TABLE plans ADD COLUMN lat REAL` (no such table: plans)
- v7: `ALTER TABLE plans ADD COLUMN lon REAL` (no such table: plans)
- v10: `ALTER TABLE plan_entries ADD COLUMN observation_windows TEXT` (no such table: plan_entries)
- v11: `ALTER TABLE plans ADD COLUMN sort_by TEXT NOT NULL DEFAULT '` (no such table: plans; the statement label is truncated in the JSON)

Tables present at the end: `custom_gear`, `dso_overrides`, `gear_setups`, `horizon_profiles`, `photos`, `plan_entries`, `plan_mosaics`, `plans`, `poi_categories`, `schema_version`, `settings`, `sky_regions`, `sqlite_sequence`, `star_correspondences`.

### Images (decode on the device)

Sources: `image.json` (collected 2026-10-03T13:05:00.730Z) and `image-memory.json` (second pass of the same three files with process memory sampled every ~60 ms from the renderer, `rendererPid` 11648, 75 samples). All files were read through `fetch(convertFileSrc(path))`. `heapPeakMB` is the JS heap only; `ImageBitmap` pixels are native memory (note in `image.json`). JS heap was 68.9 MB before, at peak and after for every row, in both files.

| Measurement            | M26.jpg (`image.json`) | M26.jpg (`image-memory.json`) | LDN1235.jpg (`image.json`) | LDN1235.jpg (`image-memory.json`) | Unit | Notes                  |
| ---------------------- | ---------------------- | ----------------------------- | -------------------------- | --------------------------------- | ---- | ---------------------- |
| File size              | 5.5                    | 5.5                           | 9                          | 9                                 | MB   | `sizeMB`               |
| Resize to 2048, size   | 2048x1102              | 2048x1102                     | 2048x1152                  | 2048x1152                         | px   |                        |
| Resize to 2048, cold   | 400                    | 346                           | 591                        | 543                               | ms   | `msCold`               |
| Resize to 2048, warm   | 327                    | 319                           | 548                        | 517                               | ms   | `msWarm`               |
| Full-size decode, size | 3331x1791              | 3331x1791                     | 5760x3239                  | 5760x3239                         | px   | `fullSize`, `ok: true` |
| Full-size decode, time | 135                    | 163                           | 333                        | 308                               | ms   | `fullSize.ms`          |

FITS (`LDN1235.fit`, 213.5 MB, 5760x3239, 3 channels, 53.4 MB output):

| Measurement | `image.json` | `image-memory.json` | Unit | Notes           |
| ----------- | ------------ | ------------------- | ---- | --------------- |
| Read        | 1110         | 1363                | ms   | `fits.readMs`   |
| Decode      | 707          | 732                 | ms   | `fits.decodeMs` |
| Total       | 1819         | 2095                | ms   | `totalMs`       |

Process memory of the renderer during the `image-memory.json` pass:

| Measurement | Value | Unit | Notes                                               |
| ----------- | ----- | ---- | --------------------------------------------------- |
| RSS before  | 147   | MB   | `before.rssMB`                                      |
| RSS after   | 426   | MB   | `after.rssMB`                                       |
| Peak RSS    | 426   | MB   | `peakRssMB`; first reached at the sample `tMs` 4271 |
| Peak HWM    | 426   | MB   | `peakHwmMB`; `before.hwmMB` was 419                 |
| Swap        | 36    | MB   | `swapMB`, constant in all samples                   |
| Samples     | 75    | n/a  | `sampleCount`                                       |

### Test photos, which carry a WCS

Sources: `photo-inspection.json` (generated 2026-10-03T12:37:36.991Z) and `test-photos.json` (generated 2026-10-03T12:56:16.513Z); the 18 image rows are identical in both. No XISF files present. `test-photos/CLAUDE.md` was skipped.

| File                              | Format | Size (bytes) | Width x height | Bit depth | Channels | WCS   |
| --------------------------------- | ------ | ------------ | -------------- | --------- | -------- | ----- |
| LDN1235.fit                       | FITS   | 223902720    | 5760x3239      | 32        | 3        | true  |
| LDN1235.jpg                       | JPEG   | 9443394      | 5760x3239      | 8         | 3        | false |
| M1-CCD.fit                        | FITS   | 3176640      | 1049x754       | 32        | 1        | true  |
| M1-CCD.jpg                        | JPEG   | 199519       | 1049x754       | 8         | 1        | false |
| M101.fit                          | FITS   | 82140480     | 3204x2136      | 32        | 3        | true  |
| M101.jpg                          | JPEG   | 2483494      | 3204x2136      | 8         | 3        | false |
| M104-CCD_Nepryadva.fit            | FITS   | 4875840      | 1311x926       | 32        | 1        | true  |
| M2.jpg                            | JPEG   | 208504       | 662x502        | 8         | 1        | false |
| M26.jpg                           | JPEG   | 5778809      | 3331x1791      | 8         | 3        | false |
| M26.tiff                          | TIFF   | 71606402     | 3331x1791      | 32        | 3        | true  |
| M2_1320s.fit                      | FITS   | 1376640      | 674x507        | 32        | 1        | true  |
| M97+M108.jpg                      | JPEG   | 2498014      | 3263x1931      | 8         | 3        | false |
| M97+M108.tiff                     | TIFF   | 75635874     | 3263x1931      | 32        | 3        | true  |
| NGC2371-Devosa.tiff               | TIFF   | 23850668     | 1904x1043      | 32        | 3        | true  |
| NGC4438-CCD_(18799) 1999 JZ73.fit | FITS   | 4610880      | 1233x931       | 32        | 1        | true  |
| NGC7331_2025rbs.tif               | TIFF   | 66045250     | 3287x1674      | 32        | 3        | true  |
| NGC7331_2026aaiv.tiff             | TIFF   | 87156286     | 3433x2115      | 32        | 3        | true  |
| NGC7331_CCD_2026aaiv.fit          | FITS   | 1267200      | 664x470        | 32        | 1        | true  |

Every FITS and TIFF file carries a WCS; every JPEG does not. Picks recorded: largest JPEG `LDN1235.jpg`, mid JPEG `M26.jpg`, highest bit-depth FITS `LDN1235.fit`.

### Network

Sources: `http.json` (run 1, collected 2026-10-03T13:25:11.165Z), `http-run2.json` (run 2, collected 2026-10-03T13:35:26.994Z), `http-nokey.json` (before the nova key was typed, 2026-10-03T13:07:24.121Z) and `overpass-plain-probe.json` (2026-10-03T13:08:17.477Z). Runs 1 and 2 were started with "Run all" on the phone; the nova key was typed on the device and neither the key nor the session was recorded. Origin `https://localhost`; `capacitorWebFetchPresent: true`, `fetchIsPatched: true`. WebView user agent: `Mozilla/5.0 (Linux; Android 16; SM-A165F Build/BP4A.251205.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.36 Mobile Safari/537.36`.

Run 1 and run 2 side by side, in the order the steps ran (`transport` is the group transport; "plain" is the unpatched WebView `fetch`, "patched" is the Capacitor-patched `fetch`, "capacitorHttp" is the `CapacitorHttp` plugin call):

| Step                                     | Transport     | Run 1                                                                                                                                 | Run 2                                                                              |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| nova login                               | patched       | ok, status 200, apiStatus success, 779 ms                                                                                             | ok, status 200, apiStatus success, 891 ms                                          |
| nova upload (a) FormData+Blob            | patched       | ok, status 200, apiStatus success, hasSubid true, bytes 16229, 13991 ms                                                               | ok, status 200, apiStatus success, hasSubid true, bytes 16558, 14380 ms            |
| nova upload (b) raw Uint8Array multipart | patched       | ok, status 200, apiStatus success, hasSubid true, bodyBytes 16707, 5238 ms                                                            | ok, status 200, apiStatus success, hasSubid true, bodyBytes 17733, 4645 ms         |
| nova poll submission (a)                 | patched       | not ok, 3402 ms, error `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`                                         | ok, status 200, attempts 2, jobIdFound true, 8481 ms                               |
| nova poll submission (b)                 | patched       | not ok, 3986 ms, error `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`                                         | not ok, attempts 8, jobIdFound false, 88881 ms                                     |
| TNS cone search                          | patched       | ok, status 200, csvRows 0, looksLikeHtmlOrJson false, rateLimitHeader "2", 1044 ms                                                    | ok, status 200, csvRows 0, looksLikeHtmlOrJson false, rateLimitHeader "2", 1029 ms |
| MPC CometEls.txt                         | plain         | ok, status 200, 163164 bytes, 961 lines, 605 ms                                                                                       | ok, status 200, 163164 bytes, 961 lines, 44 ms                                     |
| MPC CometEls.txt                         | patched       | ok, status 200, 163164 bytes, 961 lines, 754 ms                                                                                       | ok, status 200, 163164 bytes, 961 lines, 730 ms                                    |
| Overpass peaks                           | plain         | not ok, 14691 ms, error `SyntaxError: Unexpected token '<', "<?xml vers"... is not valid JSON`                                        | ok, status 200, elements 87, 846 ms                                                |
| Overpass peaks                           | patched       | not ok, 8900 ms, error `SyntaxError: Failed to execute 'json' on 'Response': Unexpected token '<', "<?xml vers"... is not valid JSON` | ok, status 200, elements 87, 520 ms                                                |
| Overpass peaks                           | capacitorHttp | ok, status 200, elements 87, 6375 ms                                                                                                  | not ok, status 429, elements null, 8573 ms                                         |

Run 2 re-runs (`reruns`, by button click) and probe (`probes`):

| Step                                                         | Transport     | Result                                               |
| ------------------------------------------------------------ | ------------- | ---------------------------------------------------- |
| Overpass peaks (once, after 30 s, per the file note)         | capacitorHttp | not ok, status 504, elements null, 8706 ms           |
| nova poll submission (a)                                     | patched       | ok, status 200, attempts 1, jobIdFound true, 3752 ms |
| nova poll submission (b)                                     | patched       | not ok, attempts 8, jobIdFound false, 87147 ms       |
| Overpass `CapacitorHttp.post` direct, about 50 s after rerun | capacitorHttp | status 200, content type `application/json`          |

First session without the nova key (`http-nokey.json`; nova login and upload not run). Patched group, then plain group:

| Step             | Transport     | Result                                                                                        |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------- |
| TNS cone search  | patched       | ok, status 200, csvRows 0, looksLikeHtmlOrJson false, rateLimitHeader "2", 1120 ms            |
| MPC CometEls.txt | patched       | ok, status 200, 163164 bytes, 961 lines, 790 ms                                               |
| Overpass peaks   | patched       | ok, status 200, elements 87, 1581 ms                                                          |
| Overpass peaks   | capacitorHttp | ok, status 200, elements 87, 893 ms                                                           |
| TNS cone search  | plain         | not ok, 1158 ms, error `TypeError: Failed to fetch`                                           |
| MPC CometEls.txt | plain         | ok, status 200, 163164 bytes, 961 lines, 638 ms                                               |
| Overpass peaks   | plain         | not ok, 8874 ms, error `SyntaxError: Unexpected token '<', "<?xml vers"... is not valid JSON` |

Overpass plain probe (`overpass-plain-probe.json`): status 200, content type `application/json`, 4299 ms. Earlier attempt about 2 minutes before: status 504, 16557 ms, Overpass dispatcher runtime error with an HTML body; the same call returned HTTP 200 JSON on retry.

Diagnoses recorded in the result files:

- Run 1 poll failure (`http.json`, `diagnosis.pollBug`): classified "SPIKE BUG (UA)". `GET https://nova.astrometry.net/api/submissions/1` with the WebView user agent (the patched fetch default) returns HTTP 200 `text/html` decoy page; with `User-Agent: MyAstroSky` (patched fetch or `CapacitorHttp.get`) it returns the JSON. Node fetch returns JSON with any user agent. Plain WebView fetch to nova GET fails with "Failed to fetch" (CORS). Fix: send `User-Agent: MyAstroSky` on the poll GET.
- Run 1 Overpass (`http.json`, `diagnosis.overpass`): classified "SERVER/NETWORK (to confirm)". Plain and patched got an XML/HTML body (status not recorded in run 1); an earlier probe of the same plain call got HTTP 504 from the dispatcher, then 200 on retry; `CapacitorHttp` got 200 with 87 elements in the same run.
- Run 2 poll UA fix (`http-run2.json`, `diagnosis.pollUaFix`): confirmed. Poll (a) returned JSON with a job id (attempt 2, then attempt 1 on re-poll).
- Run 2 poll (b) (`diagnosis.pollB`): "SERVER/NETWORK (not proven)". JSON returned each time (no parse error), jobs list empty for 8 attempts (about 88 s) in the run and again for 8 attempts (about 87 s) on re-poll; submission (b) got no job id.
- Run 2 Overpass `CapacitorHttp` (`diagnosis.overpassCapacitorHttp`): "SERVER/NETWORK". 429 in the run, 504 on the rerun, 200 on a direct probe; plain and patched got 200 with 87 elements in the same run. Body and content type were not recorded for the `CapacitorHttp` path (only status).

## Observations

From `observations.md` (device session, Galaxy A16 SM-A165F, Android 16, 2026-10-03). Reported by the user while looking at the phone; not measurements.

| #   | Observation                                                                                                   | Consequence for the real app                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The status bar is not respected**: the top of the spike app is drawn under the Android status bar.          | Android draws apps edge to edge. The app shell (card 6.0) must reserve the safe areas, top and bottom, for every screen, including the full-screen sky canvas and bottom sheets. Check on a real device. |
| 2   | The spike's test pages are unstyled test benches with one button per experiment; the user found them unclear. | Not relevant to the real app. Any future spike page should carry one line of text saying what it is and what to press.                                                                                   |

## Decisions

**Go.** No risk identified in the plan is a blocker on an entry-level phone (Galaxy A16, about 3.7 GB RAM).

1. **Star catalog: keep the JSON format.** `stars.14.json` (15.4 MB) parses in under 0.2 s and the app holds about 54 MB of JS heap after load. A binary or tiered catalog is not needed for the first release.
2. **Sky map: keep Canvas 2D and the current painters.** With the existing code, dragging runs at about 69 fps and zooming at about 79 fps. Dragging is not uniformly smooth: 16 frames took more than 25 ms in 5 s, and the longest took about 100 ms. Card 4.3 measures again with real touch gestures.
3. **Photo layer: draw photos on the canvas.** Twenty bitmaps of 2048 px pan and pinch at about 90 fps. Keep a level-of-detail cache with a budget: at most about 20 bitmaps at 2048 px in memory at once, thumbnails beyond that.
4. **SQLite: batching is mandatory.** One statement per bridge call costs about 35 ms; the same statements in one `executeSet` cost about 0.3 ms each. Any write of more than a handful of rows goes through `batch()`. A photo and its correspondences are written in one batch.
5. **Migrations: use a merged v0 baseline.** Replaying the desktop's schema history in its original order needed 11 tolerated `ALTER` errors. Set `PRAGMA foreign_keys=ON` explicitly even though it was already on.
6. **Images: decode on the device, one large file at a time.** A 9 MB JPEG decodes and resizes to 2048 px in about 0.6 s, and a 213 MB FITS decodes in about 2 s (1.8 s and 2.1 s in two runs), but process memory peaked at 426 MB. Always keep only a display copy of at most 2048 px plus a thumbnail, release the source buffer at once, and set an upper file-size limit after testing a larger file.
7. **nova.astrometry.net: native HTTP with our own user agent, and upload with a form.**
   - Every nova call goes through the native HTTP layer with `User-Agent: MyAstroSky`. With a browser-like user agent nova answers status requests with an HTML page; a plain WebView `fetch` is blocked by CORS.
   - Upload with `FormData` + `Blob` (variant a): verified end to end, a job id came back.
   - Do not use the raw-bytes multipart body (variant b): nova accepted it but produced no job id in two polls of about 90 s each. The cause is not proven.
   - Consequence: the core `HttpClient` port must support a multipart request with a file part, not only a raw byte body. No native plugin is needed.
8. **TNS: native HTTP only.** A plain `fetch` fails; the patched fetch works.
9. **MPC: a plain `fetch` works. Overpass: CORS allows a plain `fetch`, but the service is unreliable.** The plain Overpass call failed in two runs out of three with a server error page, and the native-HTTP call was refused once with 429 and once with 504. No transport was reliable, so the horizon feature must cache results, retry with a back-off, and work without the peaks when Overpass is unavailable.
10. **Real-device automation works.** The WebView can be driven over CDP through `adb forward`, and the system file picker through `uiautomator`, with no human tap.
11. **App shell: handle the safe areas.** On Android 16 the app is drawn edge to edge and the spike's content sits under the status bar.

## Not measured

- A second, slower phone.
- Real touch gestures on the sky map: the drag and zoom figures used synthetic mouse and wheel events through today's handlers. Card 4.3 measures again with the new gesture controller.
- Memory with more than 20 photos on screen, and with photos larger than the test files.
- iOS.

## Changes to the plan

- Card 4.5 (catalog format) leaves the critical path. It is reopened only if a slower device shows a problem.
- Card 2.2 (`SqlDb` adapter): add the batching rule and the measured costs as acceptance context.
- Cards 2.3 (nova solve service) and 3.1 (`Backend`/`HttpClient` types): the `HttpClient` port takes a multipart request with named parts, one of which can be a file.
- Card 4.4 (canvas photo layer): add the bitmap budget.
- Card 6.0 (app shell): safe areas at the top and bottom on every screen; pin `buildToolsVersion` for all modules to the installed version for local builds, as in the spike.

## Phone database adapter (2026-10-06)

The Capacitor SQLite adapter (`packages/backend-local/src/capacitor-sqlite-db.ts`) and the shared conformance suite (`packages/core/src/testing/sql-db-conformance.ts`), run on the phone through the spike app's `/#/sqldb` route. Raw results: `spikes/mobile/results/sqldb-*.json` (gitignored with the rest of `spikes/`).

**Device.** Samsung Galaxy A16 (SM-A165F), Android 16 (API 36), security patch 2026-08-05, Android System WebView 153.0.8010.36 (`com.google.android.webview`), plugin `@capacitor-community/sqlite` 8.1.1, Capacitor 8. Run 1 is a cold start of the app, run 2 a second run in the same process. The adapter was built with a 1 s lock timeout for the conformance cases (10 s for the timed operations).

### Conformance

11 of 11 cases pass, in both runs. A first attempt passed 9 of 11: the plugin's `execute` splits a script only at a semicolon followed by a newline and silently runs just the first statement of anything else, so `exec("A; B;")` ran `A` only (and `CREATE TABLE parent; CREATE TABLE child` created `parent` only). The adapter now splits scripts itself (outside quotes and comments) and hands the plugin one statement per line.

| Case                                                            | Run 1 (ms) | Run 2 (ms) |
| --------------------------------------------------------------- | ---------- | ---------- |
| run / get / all / exec, changes and lastInsertRowid             | 424        | 321        |
| round-trips strings, numbers, null and Uint8Array               | 248        | 252        |
| batch is all-or-nothing outside a transaction                   | 236        | 248        |
| a transaction commits and returns the body value                | 229        | 161        |
| a transaction rolls back and rethrows when the body throws      | 188        | 185        |
| a failing batch in a transaction rolls the whole one back       | 141        | 125        |
| two transactions started together do not overlap                | 314        | 214        |
| a nested transaction rejects with SQL_TX_NESTED                 | 1192       | 1176       |
| a call on the outer SqlDb in a body rejects (SQL_TX_OUTER_CALL) | 2234       | 2218       |
| a function taking a SqlTx works with tx and with the outer db   | 245        | 261        |
| initSchema builds the schema, foreign keys are enforced         | 815        | 772        |

The two timeout cases include the 1 s (and 2 x 1 s) lock timeout by design.

### Timings

Real core services (settings, plans, photos; fake image codec and blob store) on the adapter, on a fresh database. "Calls" are bridge calls counted around the connection.

| Operation                                                | Calls | Run 1 (ms) | Run 2 (ms) |
| -------------------------------------------------------- | ----- | ---------- | ---------- |
| `initSchema` on a fresh database (14 tables, version 14) | 23    | 453        | 410        |
| `settings.readPublic()`                                  | 1     | 21         | 12         |
| `plans.create` (empty plan)                              | 1     | 44         | 38         |
| `plans.addEntry` x 40, one by one                        | 200   | 3893       | 3832       |
| `plans.createMosaic`, 40 tiles                           | 6     | 178        | 156        |
| `photos.insert`, 60 correspondences                      | 3     | 110        | 92         |
| `plans.list()`, 20 plans of 20 entries                   | 3     | 124        | 97         |
| `plans.importPlan`, 40 entries                           | 1     | 68         | 61         |

`PRAGMA table_list` returns 16 rows on this phone (14 tables plus `sqlite_schema` and `sqlite_temp_schema`); `sqlite_master` holds 14 tables.

### Conclusions

- A bridge call costs about 19 ms here (3.9 s for 200 calls), half of the 35 ms measured in the first spike. Everything that is one `executeSet` or one `query` (plan import, photo insert with 60 correspondences, listing 20 plans) finishes in under 125 ms.
- The only slow operation is a loop of awaited calls: `addEntry` costs 5 calls (a transaction: begin, two reads, one write, commit), about 95 ms each. 40 of them take 3.8 s. A screen that adds many entries must go through a batched service method (one `importPlan`-like write or `createMosaic`), never a loop of `addEntry`.
- A transaction costs two extra hops (begin and commit). Services should keep transactions for writes that really need several reads between statements, and prefer one `batch` (one `executeSet`, atomic on its own) otherwise.
- `exec` must be one statement per line for the plugin; the adapter does it. A trigger body with inner semicolons is not supported by the splitter (the schema has none). A `batch` holding a `Uint8Array` falls back to one `run` per statement inside a transaction, because `executeSet` binds raw JSON and cannot carry a BLOB; keep BLOBs out of batches (the services keep images in the blob store).
- Outer-db calls and nested `transaction()` inside a body cannot be told apart from a legitimate wait without `AsyncLocalStorage`: they time out (`lockTimeoutMs`) instead of failing at once, and the body's transaction only rolls back if the body lets the rejection propagate. A waiter behind a busy transaction does not time out as long as the transaction keeps making `tx` calls.

## Phone backend (2026-10-06)

The assembled phone backend (`createPhoneBackend` on the Capacitor SQLite adapter and the phone adapters), run on the phone through the spike app's `/#/backend` route: the four adapter conformance suites, the backend contract, and a timing run on two real photos. Raw results: `spikes/mobile/results/backend-*.json` (gitignored with the rest of `spikes/`).

**Device.** Samsung Galaxy A16 (SM-A165F), Android 16 (API 36), Android System WebView 153.0.8010.36. Run 1 is a cold start of the app, run 2 a second run in the same process with the photos picked again.

**History.** A first attempt passed 23 of 24 cases of the backend contract (`removeAll counts: expected 2 but got 6`): the plugin's run count includes the rows deleted by foreign-key cascades. Fixed in commit 27180f8: after a DELETE, UPDATE or REPLACE that changed rows, the adapter reads `SELECT changes()` (about 19 ms extra). Its photo uploads were also refused because the test page sent no correspondences; the page is fixed, it was not an app defect.

### Suites

All five suites pass in both runs.

| Suite            | Passed, run 1 | Passed, run 2 | Run 1 (ms) | Run 2 (ms) |
| ---------------- | ------------- | ------------- | ---------- | ---------- |
| Picture files    | 7/7           | 7/7           | 1573       | 2313       |
| Pictures         | 16/16         | 16/16         | 453        | 283        |
| Network          | 8/8           | 8/8           | 605        | 563        |
| Secret           | 4/4           | 4/4           | 120        | 91         |
| Backend contract | 24/24         | 24/24         | 54083      | 49150      |

The secret suite's reload check passes: after a page reload the stored secret still decrypts (`value read`).

#### Picture files

| Case                                                                        | Run 1 (ms) | Run 2 (ms) |
| --------------------------------------------------------------------------- | ---------- | ---------- |
| put then get returns the same bytes, and size is their length               | 175        | 157        |
| a missing blob: get and size give null                                      | 38         | 85         |
| remove deletes the blob; removing a missing one is not an error             | 92         | 237        |
| put on an existing name replaces the content (a shorter one leaves no tail) | 74         | 203        |
| a 3 MB blob comes back byte for byte                                        | 971        | 1145       |
| an empty blob exists, with size 0                                           | 64         | 155        |
| the two name forms of the services: <id>.jpg and <id>_thumb.jpg             | 157        | 326        |

#### Pictures

| Case                                                                                          | Run 1 (ms) | Run 2 (ms) |
| --------------------------------------------------------------------------------------------- | ---------- | ---------- |
| probe: the stored size of a JPEG, with no orientation                                         | 2          | 0          |
| probe: the stored size (before rotation) and the orientation of a rotated JPEG                | 1          | 1          |
| probe: the size of a PNG                                                                      | 1          | 1          |
| probe rejects bytes that are not a picture                                                    | 6          | 1          |
| bakeOrientation: a rotated JPEG comes back upright, in the same format, with the corner moved | 130        | 38         |
| bakeOrientation: PNG and the extension .jpeg are accepted, .gif and .tiff are refused         | 2          | 1          |
| thumbnail: longer side at most maxSize, ratio kept, JPEG                                      | 59         | 46         |
| thumbnail: a picture smaller than maxSize is not enlarged                                     | 51         | 48         |
| thumbnail: a PNG gives a JPEG; a very small maxSize keeps at least 1 pixel                    | 30         | 32         |
| thumbnail rejects bytes that are not a picture                                                | 1          | 1          |
| encode: raw RGB to PNG (pixels exact) and to JPEG (pixels within a tolerance)                 | 106        | 54         |
| encode: one channel (grey) and four channels (with alpha) to PNG                              | 53         | 49         |
| decode: the size, a channel count of 1, 3 or 4 and data of width x height x channels          | 7          | 8          |
| decode rejects bytes that are not a picture                                                   | 1          | 1          |
| probe and bakeOrientation accept a WebP                                                       | 1          | 0          |
| bakeOrientation returns the original bytes when there is no orientation                       | 1          | 0          |

#### Network

| Case                                                                                     | Run 1 (ms) | Run 2 (ms) |
| ---------------------------------------------------------------------------------------- | ---------- | ---------- |
| GET: method, custom headers sent, status 200 and a JSON body                             | 90         | 46         |
| response header names are lower-case                                                     | 21         | 25         |
| POST with a text body: the body arrives as it is (UTF-8)                                 | 38         | 30         |
| POST with a form: text fields and a file with its name, type, size and checksum          | 120        | 106        |
| an error status (503, 404) resolves with that status and does not reject                 | 50         | 56         |
| bytes(): a binary body comes back byte for byte, and text() and bytes() can both be read | 45         | 63         |
| timeoutMs: a slow answer rejects after about the timeout, a quick one passes             | 194        | 204        |
| an address that cannot be reached rejects                                                | 46         | 32         |

#### Secret

| Case                                                                                            | Run 1 (ms) | Run 2 (ms) |
| ----------------------------------------------------------------------------------------------- | ---------- | ---------- |
| encrypts to the enc:v2:webcrypto form and decrypts back                                         | 83         | 52         |
| a second codec on the same IndexedDB key opens what the first wrote                             | 10         | 13         |
| the stored key is non-extractable                                                               | 16         | 11         |
| a value without the prefix comes back unchanged; the server form and a tampered value give null | 10         | 14         |

#### Backend contract

| Case                                                                               | Run 1 (ms) | Run 2 (ms) |
| ---------------------------------------------------------------------------------- | ---------- | ---------- |
| plans: a full life cycle (plans, entries, mosaics, order)                          | 2044       | 2276       |
| gear set-ups: a full life cycle                                                    | 1147       | 847        |
| custom gear: add, list in its own catalogue, remove                                | 919        | 659        |
| DSO corrections: a full life cycle                                                 | 964        | 919        |
| point-of-interest categories: a full life cycle                                    | 948        | 850        |
| sky regions: a full life cycle                                                     | 882        | 832        |
| photos: upload, list with size, metadata, placement, order, removal                | 22802      | 19029      |
| files: an address for a stored file and for the star catalogue                     | 657        | 651        |
| settings: read, change, set and remove the API key                                 | 916        | 833        |
| stars: search by name, nearby, by number                                           | 1479       | 1366       |
| solved files: read the solution of a FITS file, and convert it                     | 5375       | 5383       |
| solved files: a file that is not FITS or TIFF is refused                           | 640        | 626        |
| solved files: a conversion can be cancelled                                        | 602        | 561        |
| backup: export, preview, and restore into an empty backend                         | 7552       | 7416       |
| errors: invalid, notFound and conflict carry their kind and code                   | 1762       | 1727       |
| horizon: a latitude out of range is refused                                        | 617        | 549        |
| identification: a cone out of range is refused                                     | 612        | 563        |
| identification: asteroids, transients and comets from the recorded answers         | 639        | 584        |
| identification: an upstream failure is an upstream error, a TNS limit a rate limit | 622        | 551        |
| version: the latest release from the recorded answer                               | 619        | 565        |
| online solving: an unknown job and a missing key are refused                       | 560        | 610        |
| online solving: the list of past submissions and the reuse need a key too          | 599        | 598        |
| photos: a file that is not a picture is refused with a code that has a message     | 607        | 605        |
| local solvers: probes of nothing, unknown jobs, a file that cannot be solved       | 511        | 546        |

### Timings

One photo at a time through the real services: upload, display, listing, backup export, preview and restore into a second fresh backend, remove. "Calls" are bridge calls; both runs make the same number. Durations in ms, run 1 / run 2.

#### LDN1235.jpg (9,443,394 bytes, 5760x3239)

| Step                                       | Calls | Run 1 (ms) | Run 2 (ms) |
| ------------------------------------------ | ----- | ---------- | ---------- |
| photos.upload                              | 15    | 7482       | 7428       |
| files.url(picture); displayed, 5760x3239   | 0     | 197        | 170        |
| files.url(thumbnail); displayed, 400x225   | 0     | 7          | 8          |
| photos.listWithSizes                       | 3     | 51         | 29         |
| backup.exportToUser                        | 16    | 4335       | 4282       |
| backup.preview in a second fresh backend   | 4     | 48         | 45         |
| backup.restore in the second fresh backend | 22    | 7789       | 7822       |
| photos.remove                              | 5     | 151        | 125        |

Stored picture 9,443,394 bytes (the full-size original, not downscaled), thumbnail 8,869 bytes. Upload 831 / 825 ms per MB. Restore brought back 1 photo with the same file size; after remove both files are gone.

#### M26.jpg (5,778,809 bytes, 3331x1791)

| Step                                       | Calls | Run 1 (ms) | Run 2 (ms) |
| ------------------------------------------ | ----- | ---------- | ---------- |
| photos.upload                              | 11    | 6213       | 6038       |
| files.url(picture); displayed, 3331x1791   | 0     | 103        | 114        |
| files.url(thumbnail); displayed, 400x215   | 0     | 9          | 13         |
| photos.listWithSizes                       | 3     | 46         | 50         |
| backup.exportToUser                        | 13    | 2767       | 2756       |
| backup.preview in a second fresh backend   | 4     | 52         | 42         |
| backup.restore in the second fresh backend | 18    | 6555       | 6494       |
| photos.remove                              | 5     | 151        | 132        |

Stored picture 5,778,809 bytes (the full-size original, not downscaled), thumbnail 16,817 bytes. Upload 1127 / 1096 ms per MB. Restore brought back 1 photo with the same file size; after remove both files are gone.

### Memory

The JS heap stayed at 48.1 MB through every step of both photos (limit 954 MB), and the app was not killed. This says nothing about native image memory, which was not measured.

### Findings

- Upload of LDN1235.jpg (9.4 MB) takes 7.5 s (7482 / 7428 ms), about 0.8 s per MB, under the card limit of 1 s per MB, in 15 bridge calls. M26.jpg (5.8 MB) takes 6.2 s (6213 / 6038 ms), 1.1 s per MB, slightly above that limit although the results file flags it as within it. Most of the time is the picture codec (probe, bake orientation, thumbnail: about 4.3 to 4.5 s) and the file writes in chunks (1.2 to 1.9 s).
- Restore is as slow as upload (7.8 s and 6.5 s): it writes the picture again and rebuilds the thumbnail (4.4 s and 4.3 s in the codec). Export takes 4.3 s and 2.8 s.
- Display, listing, preview and remove are quick: the picture shows in 170 to 197 ms (LDN1235) and 103 to 114 ms (M26), the thumbnail in under 15 ms, `listWithSizes` 29 to 51 ms, preview 42 to 52 ms, remove 125 to 151 ms.
- The two runs agree within about 10 % on every step, so the cold start adds nothing noticeable.
- The picked photo is dropped when the page reloads: after a reload the app must ask for the file again.
- The cascade count bug (the plugin counting foreign-key cascade rows) is fixed in commit 27180f8 and the backend contract now passes 24 of 24 in both runs.

### Decisions

### After optimisation

Same phone and photos (Galaxy A16, WebView 153), final defaults: file pieces of 8 MB, thumbnail resize quality `high`. Durations in ms; "after" is run 1 / run 2.

| Step, LDN1235.jpg (9.4 MB) | Before | After       |
| -------------------------- | ------ | ----------- |
| photos.upload              | 7482   | 2146 / 2036 |
| backup.exportToUser        | 4335   | 1723 / 1754 |
| backup.restore             | 7789   | 2277 / 2302 |

| Step, M26.jpg (5.5 MB) | After       |
| ---------------------- | ----------- |
| photos.upload          | 1301 / 1325 |
| backup.exportToUser    | 1157 / 1101 |
| backup.restore         | 1488 / 1509 |

Targets: upload under 2 s narrowly missed (2.0 to 2.15 s); export and restore under 3 s met.

Upload of LDN1235 (run 2): file writes about 1436 (writeFile 1211, appendFile 225, base64 gap 23), thumbnail 431, mkdir 29, SQL about 42, the rest reading and other.

#### What changed

- **The 4.4 s "codec" time was a stall.** `OffscreenCanvas.convertToBlob` (and `canvas.toBlob`) waits about 4.0 s on this WebView whenever no animation frames are produced, and about 40 ms when a `requestAnimationFrame` loop runs during the call (one frame before the call does not help). `browser-image-codec.ts` now runs such a loop during `convertToBlob` (commit 2f8bb34).
- **The backup stores the picture uncompressed** in the ZIP: `zipSync` of 9.4 MB took 1381 ms at level 1 against 38 ms stored. The JSON files stay compressed.
- **Piece size** (9.4 MB write time, ms): 1 MB 2130, 2 MB 1670, 4 MB 1615, 8 MB 1511. The plugin costs about 225 ms/MB at 1 MB pieces and 160 ms/MB at 8 MB; the heap stayed at 48 to 54 MB at every size. 8 MB chosen.
- **Thumbnail resize quality** (decode, draw and encode in ms, LDN1235 / M26): pixelated 353 / 179, low 343 / 200, medium 383 / 219, high 380 / 233. At 2x `low` is visibly aliased; medium and high look the same and are not meaningfully slower. `high` kept.
- `createImageBitmap` with a resize takes 280 to 320 ms, the same as a full-size decode (278 ms): the decode is the cost, not the resize.
- `Uint8Array.prototype.toBase64` exists natively on this WebView: 1 MB in 0.4 ms against 84 ms in JS.

#### What remains

About 1.2 to 1.4 s of each 9.4 MB write is the Filesystem plugin itself (bridge transfer and native base64 decode). Going lower needs another way to write a file from the WebView (a plugin that accepts a blob or binary, or a local HTTP write). The thumbnail decode (about 0.43 s) could overlap with the file write; not done.

Suites on the phone after the change: picture files 7/7, pictures 16/16, network 8/8, secret 4/4, backend contract 24/24, timings 2/2.
