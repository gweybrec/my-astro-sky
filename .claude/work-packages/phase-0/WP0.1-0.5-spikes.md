### WP0.1–0.5 — Spikes: one Sonnet worker, one branch, in sequence

All five spikes are written by **one** worker on the branch `spike/mobile`, continued with SendMessage. The worker writes code only.
The orchestrator creates that branch from `mobile/phase-1` after WP0.0 and WP0.T are committed, so it has the cards and the ignore rules.
When the device session is over, the orchestrator switches back to `mobile/phase-1`.
The **orchestrator** then runs one device session. The spike branch is throwaway: it is never merged. Only the results document is copied to the phase branch (WP0.6).

**Common rules for the spike worker**

- Create `spikes/mobile/`: a minimal Vite + Vue app with `@capacitor/core`, `@capacitor/cli` and `@capacitor/android`, at the latest stable major. It has its own `package.json`; it is not a workspace.
- Run `npx cap init` and `npx cap add android`.
- Write `sdk.dir=C:\\Users\\guill\\AppData\\Local\\Android\\Sdk` into `android/local.properties`.
- Write `android.builder.sdkDownload=false` into `android/gradle.properties`.
- Create 4 routes, `/perf`, `/http`, `/sqlite` and `/image`, each in its own file.
- Add `playwright-core` as a dev dependency. Measurement scripts live in `spikes/mobile/scripts/*.mjs`, connect with `chromium.connectOverCDP('http://localhost:9223')`, and write JSON into `spikes/mobile/results/`.
- Add `spikes/mobile/scripts/cdp-forward.ps1`. It finds the PID with `adb shell cat /proc/net/unix | Select-String webview_devtools_remote`, then runs `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`.
- Before the build, measure free disk (`Get-PSDrive C`). If it is under 6 GB, stop and report.
- Run `./gradlew assembleDebug` once, from `spikes/mobile/android`, as a plain command with no environment variable in front of it: Gradle finds the SDK through `sdk.dir` in `local.properties`. It needs no device. Report the size of `~/.gradle` before and after.
- Stage and commit by explicit path. Do not commit `node_modules`, `android/build`, `android/app/build`, `android/.gradle` or `android/local.properties` (check they are ignored first).
- **Must NOT:** modify anything in `src/` or `server/`; run `cap run`; install SDK packages; read the nova API key from `data.db`.
- **Escalate if:** Gradle names a missing SDK package; a Gradle or JDK error persists after 2 attempts.

**WP0.2 — Performance page**

- Run `npx vite build` at the repo root and copy `dist/` into the spike's `webDir`.
- **Add a `fetch` shim in the spike's `index.html`** that answers 404 for `/api/*` and `/uploads/*`. Without it, Capacitor's local server answers those paths with `index.html` and status 200; `getDsoOverrides` (`api.ts:796-800`) then fails to parse JSON and `main.ts:64-72` stops at the catalog error screen.
- Measurement script, over CDP:
  - the time from navigation to the first sky render;
  - `JSON.parse` time of `stars.14.json` alone;
  - JS heap (`Performance.getMetrics`) after load;
  - fps during a scripted 5 s drag and a wheel zoom (`Input.dispatchMouseEvent`).
- **Photo layer test (new):** on `/perf`, draw 20 bitmaps of 2048 px on a canvas with `setTransform` + `drawImage`, and measure fps during a scripted pan and pinch (`Input.dispatchTouchEvent`). Use the images listed by the WP0.5 header-inspection step.

**WP0.3 — Native HTTP page**

- A text field for the nova API key. **You type the key on the phone during the device session.** The key is never read from `data.db`, never logged, never written to a results file.
- Log in to nova following `server/astrometry.ts:43`.
- Upload a small JPEG two ways, keeping `publicly_visible: 'n'` (`astrometry.ts:103`):
  - (a) `CapacitorHttp`-patched `fetch` with `FormData` + `Blob`;
  - (b) a raw `Uint8Array` multipart body built as in `astrometry.ts:133-170`, with `Buffer` replaced by `Uint8Array`/`TextEncoder`.
- Poll the submission until a job id appears.
- Run the TNS cone search with the User-Agent used in `server/tns.ts`.
- Fetch MPC `CometEls.txt` with plain `fetch`.
- Call Overpass as `server/overpass.ts:73` does, with plain `fetch`, then with CapacitorHttp.
- **Escalate if:** both upload variants fail. A native plugin is then needed; that is the Planner's decision.

**WP0.4 — SQLite page**

- Install `@capacitor-community/sqlite`.
- Copy, for this throwaway spike only, the SQL in this order: `server/db.ts:49-79`, then the statements of `server/db-migrations.ts` v1–14, then `server/db.ts:83-163`. (`applyMigrations` is called at `db.ts:80`, between the two schema halves.)
- Run `PRAGMA foreign_keys=ON`. Verify that deleting a photo cascades to `star_correspondences`.
- Insert 500 photos × 15 correspondences, timing individual `run` calls against one `executeSet`.
- Verify that `null` binds correctly.

**WP0.5 — Image page**

- **Header inspection first (Node, no device):** a script reads every file in `C:\Workspace\MyAstroSky\MyAstroSky\test-photos\` and writes a table: path, format, pixel dimensions, megapixels, bit depth, and whether a WCS is present (using `server/wcs-reader.ts`). The folder is gitignored; it is read, never modified.
- From that table, pick: the JPEG with the most megapixels, one mid-size JPEG, and the FITS with the highest bit depth. Record the choice.
- On the phone: pick the files with `@capawesome/capacitor-file-picker`, decode the JPEGs with `createImageBitmap(file, {resizeWidth: 2048})`, decode the FITS with `server/raw-decode/fits-decoder.ts` (throwaway: the `buffer` npm polyfill is allowed), and measure time and heap peak.
- `adb push` paths contain spaces and parentheses: quote them. Delete the pushed files from the phone at the end.
- There are **no XISF files** in `test-photos/`.

**Device session (orchestrator; you plug the phone in once)**

1. `adb devices` → one device in the `device` state. Record the model, Android version and WebView version (`adb shell getprop`, `dumpsys package com.google.android.webview`).
2. On the `spike/mobile` branch, in `spikes/mobile/`: `npx cap run android --target <serial>` with a timeout.
3. Run `cdp-forward.ps1`, then each measurement script. For WP0.3, ask you to type the API key on the phone.
4. Take one screenshot per page (`adb exec-out screencap -p`).
5. If you can plug in a second, slower phone, repeat steps 1–4.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. Use `internal(refactor): …` for moves and plumbing, `internal(mobile): …` for spikes.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not start a dev server. Do not kill any process.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
