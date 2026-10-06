# CLAUDE.md — `apps/mobile/`

Auto-loaded under `apps/mobile/`. The phone app: Capacitor (Android) + Ionic Vue, on the shared `@myastrosky/*` packages.

- **Device rule:** never install or launch an emulator, AVD or system image; never run sdkmanager or avdmanager; Gradle must not download SDK packages (`android.builder.sdkDownload=false`). Test on the user's real phone, and put `-s <serial>` on every adb command.
- **No screen before its board is approved** in `docs/dev/ui/mobile.md`; build exactly what the board shows. Texts, descriptions and icons come only from the boards (`design/mobile/boards/`), never invented.
- **Ionic's components first** (tabs, page, header, content, select, overlays); the look comes from the design system's `.mob-*` classes and tokens, imported from `design/mobile/ds/` (not copied). Tokens only, no raw colours or sizes. Ionic's variables are mapped to the tokens in `src/theme/ionic-tokens.css` and nowhere else. Dark only.
- **Imports:** the shared packages by `@myastrosky/*` names, the desktop's icon SVGs through `@icons/…`; nothing from the repository's `src/` or `server/` (ESLint error). What a screen needs from the desktop moves to a shared package first.
- **Texts** go through `t('…')`; the phone's own keys are in `packages/core/src/i18n/mobile/{fr,en,es,de}.ts`. Reuse an existing key when the text already exists.
- **Start-up** is `src/platform-init.ts` (storage, language, backend, hooks), awaited in `src/main.ts` before mounting; a failure shows `StartupError`. `isNativePlatform()` there is the only place that tells the phone from a browser.
- **In a phone-sized browser** (viewport 412 × 915, then 915 × 412): `npm run dev:server` with an isolated `DB_PATH` and `UPLOADS_DIR`, and `npm run mobile:dev` (port 5174; `/api`, `/uploads`, `/data` go to port 3001). The system bars are 0 in a browser: set `--safe-top` and `--safe-bottom` to `24px` on `<html>` to match the boards.
- **On the device:** `npm run mobile:sync`, then `cd apps/mobile/android && ./gradlew assembleDebug` with `ANDROID_HOME` set for the command only; install with `adb -s <serial> install -r`. Launcher icons: `npm run mobile:icons`. `android/local.properties` is git-ignored.
- **Tests:** `apps/mobile/tests/*.test.ts` (Vitest; Ionic's elements are stubbed, see `tests/helpers.ts`). Type-check: `npm run typecheck:mobile`.
