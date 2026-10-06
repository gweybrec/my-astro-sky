# WP3.7 — The phone test page and the device session

Model: sonnet for part A · Depends on: WP3.6 · Part A needs no device · Part B (the orchestrator) needs the user's phone

## Goal

Prove on the real phone that the whole phone backend works: the adapters pass their conformance suites, the backend passes the same contract as the desktop one, and the costs are measured. As for the database adapter (`docs/dev/mobile/spike-results.md`, section "Phone database adapter (2026-10-06)"), the test runs inside the throwaway app in `spikes/mobile/`, which is untracked and stays so.

## Part A — the page and the build (worker, no device)

1. In `spikes/mobile/`: `npm install @capacitor/filesystem @capacitor/share` (latest versions matching the installed Capacitor major; inside `spikes/mobile/` only, never at the repository root), then `npx cap sync android`.
2. A route `/#/backend` (`src/routes/Backend.vue`), built like `src/routes/SqlDb.vue`. A "Run" button, then in order, each result shown on the page and collected in `window.__backendResults`:
   - the three adapter suites of WP3.6 on the phone's adapters (picture files, pictures, network). The network suite targets `http://localhost:8799` (the echo server of WP3.6 running on the computer, reached through `adb reverse`); allow clear-text traffic to `localhost` in this test app only;
   - the secret codec: encrypt, decrypt, a second decrypt after reloading the page (the key persists), a value with a foreign prefix;
   - `createPhoneBackend` with the real plugins on a fresh database file and a fresh pictures folder, then **the backend contract suite** on it. Its outgoing network is answered from the recorded fixtures as in the Node runs (wrap the HTTP client; copy the fixtures the Node helper uses into the app's assets). The contract's files (the small JPEG, the FITS file, the backup) are bundled as assets and turned into `FileSource`s;
   - **timings and memory**, with the largest JPEG of the user's `test-photos/` that the earlier image spike used (pushed to the phone by the orchestrator and picked with the file picker as in `src/routes/Image.vue`), plus a mid-size one: `photos.upload` end to end (read, orientation, store, thumbnail, database), then `files.url` of the stored picture and of its thumbnail loaded in an `<img>` (must display; record natural width and height), `photos.listWithSizes`, `photos.remove` (both files gone, checked with `stat`); a backup export of that one photo and its restore into a second fresh backend; the number of bridge calls of each step (wrap the plugin objects with counters as `SqlDb.vue` does) and its duration.
3. A script `spikes/mobile/scripts/run-backend.mjs <label>`, built like `run-sqldb.mjs`: opens the page over the debugging connection, clicks "Run", waits for `window.__backendResults` (up to 15 minutes), writes `results/backend-<stamp>-<label>.json`, takes a screenshot with adb, prints one line per suite (`passed/total`).
4. Build the debug app without a device: set `ANDROID_HOME` for the command only (`C:\Users\guill\AppData\Local\Android\Sdk`), check that `android/gradle.properties` still has `android.builder.sdkDownload=false`, measure the free space of `C:` first (stop below 6 GB), run `./gradlew assembleDebug` in `spikes/mobile/android`. If Gradle names a missing SDK package, stop and report its name: never install one.
5. **Commit:** only the tracked files this card changed, if any (documentation is part B). If nothing tracked changed, no commit: say so, and set the card's row to `part A done` in the next commit of part B.

## Part B — the device session (orchestrator; the planner asks the user to plug the phone in first)

1. `adb devices` shows exactly one device in the state `device`; record its serial, model, Android and WebView versions. Otherwise stop and report. **Never start an emulator; never run sdkmanager or avdmanager.**
2. Start the echo server on the computer (port 8799; record its process id; stop it at the end, killing only that process), `adb -s <serial> reverse tcp:8799 tcp:8799`.
3. Install the debug app built in part A (`adb -s <serial> install -r …app-debug.apk`), start it, run `scripts/cdp-forward.ps1`.
4. Push the two test pictures to the phone's Download folder (quote the paths), run `node scripts/run-backend.mjs cold`; the file picker step is driven as `scripts/pick-click.mjs` does. Run a second time (`second`) without restarting the app.
5. Delete the pushed pictures from the phone, remove the `adb reverse`, stop the echo server. Leave the test app installed.
6. A failed case goes to the worker of WP3.6 (the adapters) or of part A (the page) with the case's output, at most twice each; then stop and report.
7. A sonnet worker writes the section "Phone backend (date)" of `docs/dev/mobile/spike-results.md` from the two result files: one table per suite (passed/total), the timings and bridge calls per step, the memory peak, the picture sizes used, and "Decisions" left empty for the planner. One commit with the status row: `internal(mobile): record the phone backend results`.

## Must NOT

- Read or log the astrometry key; no step of this card needs it.
- Stage anything under `spikes/`.
- Install SDK packages, emulators or system images; run `cap run` without `--target <serial>` and a timeout.

## Escalate if

- The stored picture does not display through `files.url` (give the address produced and what the WebView answered).
- Writing a picture takes more than 1 second per megabyte, or the app is killed for memory.
- The patched `fetch` does not send the form as the echo server expects.

## Report

Part A: files created under `spikes/mobile/`, the build's result and the size of the app file, free disk space before and after. Part B: the device, each suite's `passed/total` for both runs, the timings table, every failed case and its fix.
