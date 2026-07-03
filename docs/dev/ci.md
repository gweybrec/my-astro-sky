# GitHub Actions CI / Release Workflows

All workflows live in `.github/workflows/`. They are independent — each serves a different purpose.

---

## CI (`ci.yml`)

**Trigger:** push or PR to `master` or `dev` (the `dev` trigger means lint/typecheck/build run before a PR is opened against `master`)

**Runner:** `ubuntu-latest`

**Steps:**

1. `npm run typecheck:client` (`vue-tsc --noEmit`) — type-checks the frontend, including inside `.vue` SFCs (plain `tsc` treats `.vue` files as opaque via the shim and does not check their `<script>` blocks)
2. `npm run typecheck:server` (`tsc --noEmit -p tsconfig.server.json`) — type-checks the Express backend
3. `cmp public/icon.png docs/icon.png` — **blocking**: `docs/icon.png` is a committed copy kept in sync by `npm run generate-icons` (see [Building the packages](distribution.md#building-the-packages)); this catches drift since the workflow-free GitHub Pages docs site can't regenerate it at deploy time
4. `npm run lint` (`eslint .`) — **warn-only**: every rule is `warn`, so ESLint exits 0 and this step surfaces issues in the log without failing the build (see `eslint.config.js` and `CLAUDE.md`)
5. `npm run format:check` (`prettier --check .`) — **blocking**: fails if any file isn't Prettier-formatted
6. `npx vite build` — verifies the frontend bundles without errors

This workflow does **not** build or run Electron — it only validates that the TypeScript compiles, the code is lint-clean/formatted, and Vite produces a valid bundle.

---

## Tests (`test.yml`)

**Trigger:** push or PR to `master` / `main`

**Runner:** `ubuntu-latest`, Node.js 24

**Steps:**

1. `npm ci` — install dependencies
2. `npm test` — runs the full Vitest suite (`tests/unit/` + `tests/components/`)
3. Coverage artifacts uploaded to GitHub (`coverage/`, retained 7 days)

---

## Docker (`docker.yml`)

**Trigger:** push or PR to `master`, **path-filtered** — only runs when something that affects the image changes (`Dockerfile`, `docker-compose.yml`, `.dockerignore`, `server/**`, `public/**`, `resources/**`, `src/**`, `index.html`, `package*.json`, `vite.config.ts`, `uno.config.ts`, `tsconfig*.json`, or the workflow itself). Doc-only changes don't trigger a build.

**Runner:** `ubuntu-latest`

**Steps:**

1. `docker/setup-buildx-action` + `docker/build-push-action` — build the image (`load: true`) with GitHub Actions layer cache (`cache-from`/`cache-to: type=gha`). Cold builds take a few minutes (two `npm ci` passes + native `better-sqlite3`/`sharp` rebuild + `vite build`); cached runs are much faster.
2. **Smoke test** — `docker run` the image, poll `GET /api/config` until healthy, then hit `GET /api/telescopes`. `/api/config` proves the server booted; `/api/telescopes` returns the built-in gear catalog read from `resources/*.json` at startup, proving the Dockerfile wired up `RESOURCES_DIR` (and, alongside `PUBLIC_DATA_DIR` / `STAR_CATALOG_PATH`, the catalog assets). On failure the container logs are dumped.

This guards the **recommended self-hosting path** (walkthrough in [installing-app.md](/user/installing-app.md#self-hosting-for-a-group-docker), operator reference in [distribution.md](/dev/distribution.md#option-4--self-hosted-docker-share-via-url)). It exists because the Dockerfile previously rotted unnoticed — nothing in CI ever built it.

> **TODO — publish to GHCR (deferred).** This workflow only _builds and smoke-tests_ the image; it does not publish it. A future enhancement will push the image to `ghcr.io/gweybrec/my-astro-sky` on tag/release (add `permissions: packages: write`, `docker/login-action` against `ghcr.io`, and `push: true` with versioned + `latest` tags) so users can `docker pull` instead of `docker compose up --build`.

---

## Docs site (GitHub Pages, no workflow)

The docsify site in `docs/` is **not** deployed by a workflow — it uses GitHub Pages' built-in **"Deploy from a branch"** source (**Settings → Pages → Source → Deploy from a branch → `master`, folder `/docs`**), configured once in the repo settings. GitHub republishes it automatically on every push to `master`, no CI involved.

`docs/.nojekyll` disables GitHub's default Jekyll processing, which would otherwise silently drop underscore-prefixed files like `docs/_sidebar.md` and break docsify's navigation. It's required either way, independent of which Pages source is used.

An Actions-based deployment (`actions/upload-pages-artifact` + `actions/deploy-pages`) was considered but dropped — for a purely static site with no build step, it's equivalent to the branch-deploy source and adds a workflow to maintain for no functional benefit.

---

## Release (`release.yml`)

**Trigger:**

- Push a tag matching `v*` (e.g. `v1.0.0`) — automatic
- Manual via the "Run workflow" button in the Actions tab (`workflow_dispatch`), with an optional `tag_name` input

**What it does:**

Three build jobs run in parallel (Windows, Linux, macOS — the last is a 2-arch matrix), then a final job assembles the GitHub Release.

Every build job runs `npm run generate-icons` before `electron:make`, because `build/` is gitignored — without it the packaged apps fall back to the default Electron icon.

### `build-windows` (`windows-latest`)

1. `npm ci`
2. `npm run generate-icons`
3. `npm run electron:make` — clean → tsc/vite build → `electron-rebuild` (recompiles native modules for Electron ABI) → `electron-forge make`
4. Uploads two artifacts:
   - `out/make/squirrel.windows/x64/MyAstroSkySetup.exe` — Windows installer (Squirrel)
   - `out/make/zip/win32/x64/MyAstroSky-win32-x64-<version>.zip` — Windows portable zip

### `build-linux` (`ubuntu-latest`)

1. `sudo apt-get install -y build-essential python3` — needed to compile `better-sqlite3` from source
2. `npm ci`
3. `npm run generate-icons`
4. `npm run electron:make`
5. Uploads two artifacts:
   - `out/make/deb/x64/my-astro-sky_<version>_amd64.deb` — Debian/Ubuntu installer
   - `out/make/zip/linux/x64/MyAstroSky-linux-x64-<version>.zip` — Linux portable zip

### `build-macos` (matrix: `macos-14` arm64 + `macos-13` x64)

Runs once per architecture. No `apt-get` step is needed — macOS runners ship Xcode Command Line Tools + Python, so `better-sqlite3` compiles and `electron-rebuild` works; `sharp` resolves its per-arch prebuilt binary (`@img/sharp-darwin-arm64` / `@img/sharp-darwin-x64`) during `npm ci`.

1. `npm ci`
2. `npm run generate-icons`
3. `npm run electron:make`
4. Uploads (artifact name `macos-artifacts-<arch>`, unique per matrix leg):
   - `MyAstroSky-<arch>.dmg` — drag-to-Applications disk image
   - `out/make/zip/darwin/<arch>/MyAstroSky-darwin-<arch>-<version>.zip` — portable zip

The DMG filename embeds the arch (via `process.arch` in `forge.config.ts`) so the two matrix legs don't collide when attached to one Release. The builds are **unsigned** — see [distribution.md](/dev/distribution.md) for the Gatekeeper workaround users need on first launch.

> **Cost note:** macOS runners are free for public repos but billed at a **10× minute multiplier** for private repos. This job runs twice (one per arch) per release.

### `release` (`ubuntu-latest`)

Runs after all three build jobs succeed. Steps:

1. **Checkout** the default branch with `fetch-depth: 0` (full history + tags are required for the changelog, and the regenerated changelog files are committed back to the branch — not the detached tag).
2. **Setup Node + `npm ci`** — installs the `git-cliff` devDependency used by the changelog script.
3. **Generate changelog files** — `npm run changelog` runs [`scripts/generate-changelog.mjs`](../../scripts/generate-changelog.mjs), which calls [git-cliff](https://git-cliff.org) (config `cliff.toml`) once per major version series (see _Changelog scoping_ below).
4. **Build release notes** — `npx git-cliff --latest --strip header --output RELEASE_BODY.md`; that file becomes the GitHub Release body (the latest version's section only). `RELEASE_BODY.md` is gitignored and never committed.
5. **Commit the regenerated changelog file(s)** (`CHANGELOG.md` + any `CHANGELOG.v*.md`) back to the default branch with a `chore: update changelog … [skip ci]` message — `chore:` is skipped by `cliff.toml`, so this auto-commit never pollutes the next release's changelog; `[skip ci]` keeps it from re-triggering CI/test. This commit lands _after_ the tag, since tags are immutable.
6. **Download every artifact** (Windows + Linux + the two macOS arch legs, merged via `pattern: macos-artifacts-*`) and **publish the GitHub Release** with the git-cliff changelog as the body (`body_path: RELEASE_BODY.md`).

#### Changelog scoping (per major version series)

`scripts/generate-changelog.mjs` keeps **`CHANGELOG.md` scoped to the current (highest) major version series** and freezes older majors into archive files:

- `CHANGELOG.md` → all releases of the current major (e.g. every `v1.x.y`).
- `CHANGELOG.v0.md`, `CHANGELOG.v1.md`, … → one archive per **completed** major series.

The script reads the version tags, groups them by major, and runs git-cliff with a git range per series (`<last tag of previous major>..<last tag of this major>`; the open series runs to `HEAD`, the oldest series from the repo root). When no tags exist yet it assumes **v0.0.0** — a single `CHANGELOG.md` over all history. The first release of a new major (e.g. `v1.0.0`) therefore regenerates `CHANGELOG.md` for the `v1.x` range and writes the frozen `v0.x` history to `CHANGELOG.v0.md` automatically.

> **Conventional Commits required.** The changelog is built by parsing commit messages (`feat:`, `improvement:`, `fix:`, `perf:`, `refactor:`, `docs:`…). Non-conventional commits are filtered out. Grouping, ordering, and the custom `improvement:` type live in `cliff.toml`. Preview locally with `npm run changelog`.
>
> **Branch protection caveat:** the commit-back step pushes with the default `GITHUB_TOKEN`. If the default branch has a ruleset blocking direct pushes by Actions, this step fails — allow the Actions bot to push, or switch the step to open a PR.

---

## How to publish a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow runs automatically and creates a GitHub Release with all platform binaries attached (Windows installer + zip, Linux deb + zip, macOS dmg + zip for both arm64 and x64).

## Re-running a release build

Go to **Actions → Release → Run workflow** in the GitHub UI. Optionally enter a `tag_name` (e.g. `v1.0.0`) to associate the release with an existing tag. If left blank, the workflow uses the current branch name.

---

## Native module builds

`better-sqlite3` and `sharp` are native Node addons. The `electron-rebuild` step recompiles them against Electron's ABI (which differs from the host Node.js ABI). Without this step the packaged app segfaults on launch. The `rebuildConfig: { force: true }` in `forge.config.ts` ensures the rebuild always runs even if the modules appear up to date.

`sharp` v0.34+ ships prebuilt binaries via `@img/sharp-linux-x64` / `@img/sharp-win32-x64`, so it does not require `libvips` installed on the host. `better-sqlite3` always compiles from source and requires a C++ toolchain (`build-essential`) and Python 3.
