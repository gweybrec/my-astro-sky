---
name: mobile-device-test
description: >
  Test the phone app (apps/mobile) on the user's real Android phone: build, install,
  drive the WebView over its debugging connection, check what a browser cannot show
  (safe areas, back button, keyboard, permissions, file picker), and restore the phone's
  settings. Never an emulator.
  Trigger phrases: "test on the phone", "test on device", "real device", "install on the
  phone", "adb", "run on Android", "device test", "check on the phone".
---

# Test on the Real Phone

Scripts are in `.claude/skills/mobile-device-test/scripts/` (Node, run from the repository root). They take the serial as `--serial <serial>`; the package id comes from `apps/mobile/capacitor.config.ts`.

## Step 1 — The device rule

**Real device only. NEVER install, create or launch an emulator, an AVD or a system image. Never run `sdkmanager` or `avdmanager`. Gradle must not download SDK packages (`android.builder.sdkDownload=false`). Set `ANDROID_HOME` for the command only. Every adb command carries `-s <serial>`.**

Run `node .claude/skills/mobile-device-test/scripts/device-info.mjs`. If no device is listed, or the phone is locked or asleep, **stop and ask the user to plug it in and unlock it**. Never try to unlock it. Touch nothing on the phone but the app.

## Step 2 — Before

- At least 6 GB free on the system drive before a Gradle build.
- Record the settings: `settings-guard.mjs record --serial <s> --file <folder under .playwright-mcp>/settings.json` (it saves `stay_on_while_plugged_in`, `accelerometer_rotation`, `user_rotation`). Then `settings-guard.mjs stayon --serial <s>`.
- At the end, whatever happens: `settings-guard.mjs restore --serial <s> --file …`. It reads the three back and exits 1 if one differs.

## Step 3 — Build and install

1. `npm run mobile:sync`
2. `cd apps/mobile/android` and run `./gradlew assembleDebug` with `ANDROID_HOME` set for that command. If Gradle names a missing SDK package, stop and tell the user; do not fetch it.
3. `adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk`. Installing keeps the app's data and does not need the phone unlocked. Never clear the app's data without the user's yes.
4. Under Git Bash, set `MSYS_NO_PATHCONV=1` for any adb command that has a device path.

## Step 4 — Drive the app

- Prefer the WebView's debugging connection to taps. `cdp-connect.mjs --serial <s>` finds the app's socket, forwards it to a local port and prints the page's URL and title. In your own script, `import { connect } from './cdp-connect.mjs'` to get a `playwright-core` page, and call `close()` when done (it removes the forward). The app must be a debug build and running.
- Never send a tap without first reading what is on screen (`adb -s <s> shell uiautomator dump`, then read the file) and checking the app is in front.
- Taps are for system dialogs only: permission, file picker, share sheet.
- Never send anything out of the phone (no message, no share to a contact, no upload).
- `screenshot.mjs --serial <s> --dir .playwright-mcp/<folder> --name <name>` saves a screenshot. It refuses any folder outside `.playwright-mcp/`. Captures are never committed.
- `settings-guard.mjs rotate --serial <s> --rotation <0-3>` turns the screen (1 and 3 are the two landscapes).

## Step 5 — What to check

A browser cannot show these:

- Start-up: no console error; the local database is in use, not an HTTP backend.
- Safe areas: portrait and both landscapes (`user_rotation` 1 and 3), with gesture navigation and with three-button navigation.
- The back button with a dialog open, with a sheet open, on a sub-page, and on a tab's first page.
- The keyboard does not hide the focused field.
- Permissions (position) and the file picker and share sheet.
- The time the slow paths take (import, first load of the catalogues).

## Step 6 — Test data

- Build test data on an isolated database on the computer (`DB_PATH` and `UPLOADS_DIR` in a new scratchpad folder), export it, and bring it to the phone through the app's own import screen. Never use the user's data.
- Keep captures and files in `.playwright-mcp/`, never in git.

## Step 7 — Clean up and report

- Restore the settings (Step 2) and remove the forward (`adb -s <s> forward --remove tcp:<port>`). Leave the app installed.
- Tell the user exactly what is left on the phone: the app version, the data you imported or created, and any setting that differs from before.
- Write no status or log in a tracked file; report in the conversation.
