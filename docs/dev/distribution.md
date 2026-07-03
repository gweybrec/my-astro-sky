# Distribution & deployment

How to build, run from source, and package MyAstroSky. Intended for developers and maintainers.

> **Looking to install or self-host the app, not build it from source?** See [Installing MyAstroSky](/user/installing-app.md) — desktop app download, self-hosting via Docker, and LAN sharing, all end-user-facing.

---

## Table of Contents

- [Distribution \& deployment](#distribution--deployment)
  - [Table of Contents](#table-of-contents)
  - [Option 1 — Local development](#option-1--local-development)
  - [Option 2 — Production build (Node.js)](#option-2--production-build-nodejs)
  - [Option 3 — Local network sharing](#option-3--local-network-sharing)
  - [Option 4 — Self-hosted Docker (share via URL)](#option-4--self-hosted-docker-share-via-url)
  - [Configuration reference](#configuration-reference)
  - [Option 5 — Desktop app with Electron](#option-5--desktop-app-with-electron)
    - [Architecture](#architecture)
    - [Building the packages](#building-the-packages)
    - [Implementation notes](#implementation-notes)
    - [Platform notes](#platform-notes)
    - [ASTAP path on Windows](#astap-path-on-windows)

---

## Option 1 — Local development

```bash
git clone https://github.com/gweybrec/my-astro-sky.git
cd my-astro-sky
npm install
bash scripts/download-catalog.sh 14   # optional but recommended
npm run dev
```

Opens Vite on `:5173` (hot-reload) and Express on `:3001`. Vite proxies `/api` and `/uploads` to the Express backend.

---

## Option 2 — Production build (Node.js)

```bash
npm run build          # tsc type-check + Vite build → dist/
npx tsx server/index.ts
```

Express serves the built frontend from `dist/` on `:3001`. Requires Node.js 24.18+ on the host.

---

## Option 3 — Local network sharing

Run Option 2, find your LAN IP (`ip a` on Linux, `ipconfig` on Windows), and share `http://<lan-ip>:3001` with anyone on the same Wi-Fi or network. No internet required, no server needed. The same walkthrough, phrased for end users, is in [Installing MyAstroSky](/user/installing-app.md#sharing-on-your-local-wifi-lan).

---

## Option 4 — Self-hosted Docker (share via URL)

The recommended way to host for others. Requires Docker on any Linux server or VPS (1 GB RAM is sufficient). The basic `docker compose up --build -d` walkthrough is in [Installing MyAstroSky](/user/installing-app.md#self-hosting-for-a-group-docker) — the reference below is the operator-level detail (volumes, image contents) for whoever maintains the instance.

`docker-compose.yml` stores the SQLite database (`/data`) and uploaded photos (`/app/uploads`) in named Docker volumes (`dbdata` and `uploads`) — data survives container restarts and image rebuilds. Inspect or back them up with `docker volume ls` / `docker volume inspect`. `stars.14.json` is committed to the repo and baked into the Docker image automatically.

---

## Configuration reference

Solver settings (ASTAP path, solve-field path, index file directory) and the astrometry.net API key are stored in the SQLite database and configured through the app **Settings** panel — they are **not** environment variables. The only env vars are infrastructure-level ones listed below.

Copy `.env.example` to `.env` and fill in what you need (Node.js / Docker deployments only — `.env` is not loaded in Electron):

| Variable                  | Default                     | Purpose                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASTROMETRY_API_KEY`      | _(none)_                    | astrometry.net online API key. If set via env var, the value is used directly and in-app edits are blocked (`SETTING_LOCKED_BY_ENV`). Useful for Docker secrets or CI.                                                                        |
| `STAR_CATALOG_PATH`       | `public/data/stars.14.json` | Path to the star catalog JSON used for WCS star matching.                                                                                                                                                                                     |
| `PORT`                    | `3001`                      | TCP port Express listens on.                                                                                                                                                                                                                  |
| `DB_PATH`                 | `./data.db`                 | SQLite database path.                                                                                                                                                                                                                         |
| `SETTINGS_ENCRYPTION_KEY` | _(auto in Electron)_        | Base64-encoded 32-byte key for encrypting secrets (e.g. the API key) in the DB. Electron auto-provisions it via `safeStorage`. For Docker, inject it as a secret if you want at-rest encryption; omit it and secrets are stored in plaintext. |

In the Electron desktop app, `.env` is never loaded. `DB_PATH`, `UPLOADS_DIR`, `STAR_CATALOG_PATH`, and `PORT` are set programmatically by `electron/main.ts` at startup.

### Security headers / CSP

Express (via `helmet`) sends a Content-Security-Policy on every response. It restricts scripts to same-origin (`script-src 'self'`), allows images from same-origin plus `data:`/`blob:` (thumbnails and previews), and permits the Google Fonts CDN (`fonts.googleapis.com` / `fonts.gstatic.com`). All `fetch`/XHR is same-origin (`connect-src 'self'`). `upgrade-insecure-requests` is intentionally **not** set, so plain-HTTP LAN access works; put the app behind an HTTPS reverse proxy for any internet-facing deployment. The same header is served to the Electron renderer (it loads from this server). The dev-only Swagger UI at `/api/docs` is exempt from the CSP.

---

## Option 5 — Desktop app with Electron

Self-contained desktop app for non-developer astronomers — no terminal or Docker required.

### Architecture

The Electron **main process** (Node.js) starts the Express server internally. The renderer `BrowserWindow` loads `http://localhost:<port>`. Everything is bundled into a single `app.asar`.

```
MyAstroSky.exe
└── app.asar
    ├── electron/main.js       ← Electron entry point, starts Express
    ├── server/ (compiled JS)  ← Express backend
    ├── dist/                  ← Vite-built frontend
    └── public/data/           ← star & DSO catalogs (read-only, ~20 MB)
```

User-writable data lives outside the asar, in the OS user-data directory:

| OS      | Path                                        |
| ------- | ------------------------------------------- |
| Windows | `%APPDATA%\MyAstroSky\`                     |
| Linux   | `~/.config/MyAstroSky/`                     |
| macOS   | `~/Library/Application Support/MyAstroSky/` |

The Electron main process sets `UPLOADS_DIR` and `DB_PATH` env vars pointing there before starting Express.

Error diagnostics logs are written to `<userData>/logs/` as JSON-lines (`.jsonl`) batch files. There are two independent streams in that folder:

- **`my-astro-sky-errors-YYYYMMDD-HHMMSS-mmm.jsonl`** — JavaScript errors: renderer uncaught errors/rejections, Vue component errors, error-toast-reported failures, and main-process `uncaughtException`/`unhandledRejection`.
- **`my-astro-sky-crash-YYYYMMDD-HHMMSS-mmm.jsonl`** — crashes that JS handlers cannot represent in the errors stream: `renderer_process_gone`, `child_process_gone` (GPU/utility), `window_unresponsive`, and `native_crash_detected` breadcrumbs.

(Older single-event files named `my-astro-sky-error-…-xxxxxx.json` from previous versions are still recognized for cleanup.) Each stream rotates to a new file every 100 records and is independent — crashes never disturb the errors stream's rotation.

#### Native crash capture (Crashlytics-style, local-only)

Electron's `crashReporter` is started in [electron/main.ts](../../electron/main.ts) with `uploadToServer: false`, so it captures **native** crashes (segfaults in `better-sqlite3`/`sharp`, renderer/GPU process crashes, OOM kills) that no JS handler can catch. These are written as Crashpad **minidumps** to `<userData>/Crashpad/` and are **never uploaded** — they stay on the user's machine, matching the app's offline, privacy-first design.

Because a native main-process crash kills the process before any JS runs, [electron/error-logger.ts](../../electron/error-logger.ts) scans the crash-dumps directory on the **next** startup and writes a `native_crash_detected` breadcrumb (with the dump filename) to the crash stream — so even hard crashes are discoverable from the same logs folder. A `.crash-seen.json` marker in the logs folder dedupes already-reported dumps.

When the **renderer** crashes (white screen), [electron/main.ts](../../electron/main.ts) logs `renderer_process_gone` and auto-reloads the window to recover. A loop-guard ([electron/crash-reload-guard.ts](../../electron/crash-reload-guard.ts)) caps this at 3 reloads per 60 s; beyond that it stops and shows a Reload/Quit dialog instead of looping.

To diagnose a user's crash, have them use **Open logs folder** (Settings) and send the whole `logs/` folder; for native stacks, also collect `<userData>/Crashpad/`.

Log files older than 30 days (errors and crash streams alike) are automatically pruned at app startup.

Important limitation (expected behavior):

- The **Open logs folder** action is available only in the Electron desktop app.
- In browser/web deployments (Docker, Node.js server, hosted URL), this action is intentionally unavailable and this is **not a bug**.
- Reason: opening a local OS folder requires Electron desktop APIs, which are not present in standard browsers.

### Building the packages

End-user download, install, and uninstall steps live in [Installing MyAstroSky](/user/installing-app.md) — this section is about producing the packages, for whoever cuts a release.

> **Prerequisites:** `build/icons/` must exist before running `electron:make`. Generate it once with:
>
> ```bash
> npm run generate-icons
> ```
>
> Re-run it any time `public/icon.png` changes. The `build/icons/` directory is not committed to the repo, but
> the script also writes `docs/icon.png` (a committed copy, used by the docs site) — commit that alongside
> your `public/icon.png` change. `ci.yml` fails the build if the two ever drift, since the workflow-free
> GitHub Pages docs site (see [Docs site (GitHub Pages, no workflow)](#docs-site-github-pages-no-workflow))
> has no build step to regenerate it at deploy time.

Generate the platform packages from the repo root:

```bash
npm run electron:make
```

**Linux** — produces two outputs in `out/make/`:

| File                                                 | Corresponds to                          |
| ---------------------------------------------------- | --------------------------------------- |
| `deb/x64/my-astro-sky_<version>_amd64.deb`           | The `.deb` installer end users download |
| `zip/linux/x64/my-astro-sky-linux-x64-<version>.zip` | The portable zip end users download     |

**Windows** — run `npm run electron:make` on a Windows machine (cross-compiling from Linux is not supported by Squirrel). Produces:

| File                                                              | Corresponds to                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `out/make/squirrel.windows/x64/MyAstroSkySetup.exe`               | The installer end users download                                  |
| `out/make/squirrel.windows/x64/my-astro-sky-<version>-full.nupkg` | Used internally by Squirrel for updates — not needed by end users |

> **Prerequisites on Windows:** Node.js 24.18+, Git, `npm install`, and `npm run generate-icons` (see above).

**macOS** — built per-architecture (`MakerZIP` + `MakerDMG` for `darwin`). The release workflow builds both Apple Silicon (`arm64`, on a `macos-14` runner) and Intel (`x64`, on a `macos-13` runner). Per architecture it produces:

| File                                                                | Corresponds to                      |
| ------------------------------------------------------------------- | ----------------------------------- |
| `MyAstroSky-<arch>.dmg`                                             | The disk image end users download   |
| `out/make/zip/darwin/<arch>/MyAstroSky-darwin-<arch>-<version>.zip` | The portable zip end users download |

Choose by your Mac: **Apple Silicon (M1/M2/M3+) → `arm64`**, **Intel → `x64`**. An `arm64` build will not run on an Intel Mac.

> **Gatekeeper (unsigned app):** these builds are **not code-signed or notarized** (no Apple Developer ID) — macOS will refuse to open them on first launch. The end-user workaround (right-click → Open) is documented in [Installing MyAstroSky](/user/installing-app.md). This is expected for unsigned apps, not a bug; removing the warning entirely would require an Apple Developer ID ($99/yr) and wiring signing + notarization secrets into the release workflow — currently not planned.

### Implementation notes

### Node.js version constraint (Electron packaging)

Node.js v24.16.0 introduced a regression in stream destruction propagation (`stream: propagate destruction in duplexPair`) that broke `fd-slicer` 1.1.0, an abandoned library (last release 2018) used by `yauzl`, which `extract-zip` depends on. The symptom was Electron packaging (`electron:make`) hanging indefinitely on the "Copying files" step — `openReadStream` would never emit `data`, `end`, or `error`.

The regression was reverted upstream and confirmed fixed in **Node.js 24.18.0** ([nodejs/node#63487](https://github.com/nodejs/node/issues/63487), now closed). A previously applied `patch-package` patch that swapped `extract-zip`'s implementation for `unzipper` is no longer needed and has been removed — `npm run electron:make` uses stock `extract-zip` again.

**Do not build on Node 26.1.0+**: a similar zip-extraction hang has been reported there ([max-mapper/extract-zip#154](https://github.com/max-mapper/extract-zip/issues/154), open as of June 2026). Stick to **Node.js 24.18+ (24.x line)** for packaging until that issue is resolved.

### Platform notes

|                     | Linux                 | macOS                  | Windows                |
| ------------------- | --------------------- | ---------------------- | ---------------------- |
| solve-field         | ✅                    | ❌ (not available)     | ❌ (not available)     |
| ASTAP               | ✅ `install-astap.sh` | install from hnsky.org | ✅ `install-astap.ps1` |
| nova.astrometry.net | ✅                    | ✅                     | ✅                     |

The UI already reads `solveFieldAvailable` from `/api/config` (set to `process.platform !== 'win32'` on the backend) and disables the solve-field option in the batch modal when it is false.

### ASTAP on Windows

`scripts/install-astap.ps1` is the native Windows installer. It prompts for an install directory, downloads `astap_cli.exe` and the D50 star catalog from SourceForge, and instructs the user to set the path in the app Settings.

The ASTAP binary path is stored in the settings DB via `getSetting('ASTAP_PATH')` (`server/astap.ts`). The Linux default (`/opt/astap/astap_cli`) does not apply on Windows — users must set the path explicitly via Settings after running the installer.

The macOS column remains manual (no script yet); users download from [www.hnsky.org/astap.htm](https://www.hnsky.org/astap.htm) and configure the path in Settings.
