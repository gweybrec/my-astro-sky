# MyAstroSky mobile — work packages

The full approved plan is in PLAN.md in this folder. This README is the orchestrator's operating manual.

## From Execution Model (§6)

**One branch, no worktrees (your decision).** All work happens in this checkout, on one branch per phase created from `dev`
(`mobile/phase-N`), plus the throwaway `spike/mobile` branch for the Phase 0 spikes. This checkout is on `dev` today.

- **Why not worktrees:** each one costs about 0.7 GB and an `npm ci`, lacks the gitignored folders (`test-photos/`, `build/icons`, `data.db`),
  and the review showed there is almost nothing to run in parallel anyway.
- **What it costs:** this checkout is on the phase branch while the orchestrator runs, so you cannot develop on another branch here at the same time.
- **Your untracked files stay in place.** `ARCHITECTURE_REVIEW.md`, `other-resources/` and the others are never added, moved or deleted.
  Workers stage files **by explicit path** (`git add <paths>`), never `git add -A` or `git add .`, and never run `git clean`.

**How many subagents.** I can't quote a fixed harness limit. With one shared checkout, the rule is simple:

- **One code card at a time.** The next worker starts only after the previous card is committed and `npm run verify` is green.
- **One docs-only card may run alongside**, because it touches different files (WP1.9).
- **Two workers may run together only on fully disjoint files**, and each stages only its own paths. This applies mainly to Phase 6 screens.
- Browser checks share one dev-server port pair and one Playwright browser, so they run one at a time.
- Device checks need your phone plugged in, so they are serialized and batched.

| Phase     | Parallelism                                                                                   |
| --------- | --------------------------------------------------------------------------------------------- |
| Phase 0   | 1                                                                                             |
| Phase 1   | 1 code card at a time, plus the docs card alongside                                           |
| Phase 2   | 1; up to 2 for services once each has its own router and service file                         |
| Phase 3/4 | 1                                                                                             |
| Phase 6   | up to 2 (screens in different files; i18n split into per-feature modules to avoid collisions) |

**Disk rules (in the orchestrator protocol)**

- About 20 GB is free on C: (measured 2026-10-03). Measure it (`Get-PSDrive C`) before any Android build or `electron:package`. If it is under 6 GB, stop and report.
- **No local `docker build`.** The `docker.yml` CI job smoke-tests the image on the PR to `master`.
- `npm run clean` deletes `dist`, `.vite` and `out`. Run it after `electron:package`, and only when no dev server is running.
- The first Android build downloads Gradle and its dependencies into `~/.gradle`. Budget **2–4 GB**, once, and report the real figure.

**Commits (verbatim block in every card and in your kick-off prompt)**

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. Use `internal(refactor): …` for moves and plumbing, `internal(mobile): …` for spikes.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

**Orchestrator protocol.** It lives in `.claude/work-packages/README.md` with the status table. That folder is not published by docsify.

1. **Start of a phase.**
   - Check that `git status` shows no modified or staged tracked files. If it does, stop and ask you; never stash.
   - Create the branch: `git switch -c mobile/phase-N dev`.
   - Run `npm run verify` once as a baseline. If it already fails (for example on your untracked files), report it and ask before starting.
2. **Pick** the next card whose dependencies are committed. One code card at a time; see the parallelism rule above.
3. **Check gates:** the design gate for UI cards (§5), and device availability for device cards.
4. **Spawn** the worker with `Agent(model per card, prompt = full card text + the Commits block + "Follow the card exactly. Stop and report on any Escalate-if condition.")`. No worktree isolation.
5. **On return:** check that the card made exactly one commit, that `git status` shows no leftover tracked changes, then run `npm run verify`.
6. **Browser acceptance is run by the orchestrator, one card at a time:**
   - first check that ports 5173 and 3001 are free (`Get-NetTCPConnection`);
   - if they are busy, **ask you** — never kill a process you didn't start;
   - stop the dev server you started by killing its full process tree, as the root `CLAUDE.md` describes.
7. **A failure** goes back to the same worker (SendMessage) with the output, at most twice. After that, escalate.
8. **Abandoning a card.** Every worker report lists the files it changed and the files it created.
   - To discard an unfinished card, restore the changed files by path (`git restore --staged --worktree <paths>`) and delete only the created files named in the report.
   - To undo a committed card, use `git revert`, which keeps the history.
   - Never use `git reset --hard`, `git clean` or `git stash`.
9. **`package-lock.json`:** only change it through `npm install`. Escalate if its diff contains lines unrelated to the card.
10. **Status table:** update it and commit it on the phase branch after every state change. States: `todo`, `running`, `done`, `failed`, `escalated`, `blocked on you (device)`, `blocked on you (design)`, `blocked on you (as-built review)`.
11. **After a restart:** rebuild the state from `git log` on the phase branch and the status table.
12. **Phase end:** you open a pull request from `mobile/phase-N` into `dev`, which runs the CI.

**Card template.** Every card follows it, so a cheaper model has everything it needs:

```
# WP-<id> <title>
Model: haiku|sonnet · Depends on: … · Parallel-safe with: … · Needs device: yes|no
## Goal            1–2 sentences.
## Step 0          Check `git branch --show-current` is the phase branch named in the kick-off. If not, stop.
## Context         Only what is needed: files with line numbers, the interfaces to implement verbatim.
## Steps           Numbered, concrete. Exact names/paths/signatures.
## Must NOT        Explicit out-of-scope list. Always includes: start a dev server, kill any process,
##                 install SDK packages or emulators, push, add AI attribution, switch branch,
##                 `git add -A`, `git clean`, `git stash`, `git reset --hard`, touch untracked files.
## Acceptance      Commands the WORKER runs (no browser, no device) + checks the ORCHESTRATOR runs.
## Gotchas         Known traps found during investigation.
## Escalate if     Conditions where the worker STOPS and reports instead of improvising.
## Commits         The verbatim block above.
## Report          Files changed · acceptance output · deviations · open questions.
```

## From Design (§5)

**Device rule (strict; in every device card, in `apps/mobile/CLAUDE.md`, and enforced by permission deny rules)**

- **Never install, create or launch an Android emulator, an AVD or a system image.**
- Never run `sdkmanager` or `avdmanager`.
- **Gradle must not download SDK packages by itself:** every Android project sets `android.builder.sdkDownload=false` in `android/gradle.properties`. If a platform or build-tools version is missing, the build fails with its name, and the worker reports it.
- `ANDROID_HOME` is set **per command** (`$env:ANDROID_HOME = '…\Android\Sdk'`), never globally.
- Never run `cap run` without `--target <serial>`, and always wrap it in a timeout. Without a target it can open an interactive device picker and hang.
- Device steps are **batched into device sessions**: the code is written without a device, then the orchestrator asks you once to plug the phone in and runs all pending device checks in sequence.
- Subagents cannot ask you anything. A worker that needs a device and finds none **escalates** to the orchestrator, which asks you.

**L2 — the real app on your real device (USB).** Driven by a **Node script** (`playwright-core` `connectOverCDP`), not by an MCP server, so subagents and the orchestrator can run it without a restart:

1. `adb devices` must show a device in the `device` state. If it doesn't, **stop and ask you to plug one in**.
2. `adb reverse tcp:5173 tcp:5173`, so live reload works over USB.
3. `npx cap run android --target <serial> --live-reload --host localhost --port 5173`, wrapped in a timeout. Always pass `--target`.
4. `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`
5. The script connects to `http://localhost:9223`, drives the app and saves screenshots and metrics as files.
6. `adb exec-out screencap -p` for native overlays (status bar, keyboard).

**The approval record.** It must be checkable by a cheap orchestrator, so it is a file, not a chat message.

- File: `docs/dev/ui/mobile.md` holds the binding rules (Ionic components only, tokens only, touch sizes) and an **approval table**.
- Table columns: screen · round · artboard link · exported PNG path · spec path · **status** (`draft` / `approved` / `as-built approved`) · **approved by you on** (date).
- Only the Planner writes `approved`, and only after your explicit message in the chat. The date and your wording are recorded.
- **Workers cannot open a private claude.ai link.** So for each approved screen, the Planner exports into the repo:
  - a PNG of the artboard per theme;
  - a written spec: the component tree mapped to Ionic components, tokens, spacing, states, empty and error states, i18n keys.
- **Hard gate, checked by the orchestrator before dispatch:** a card that touches `apps/mobile/src/**` UI is dispatched only if every screen it names has status `approved` and its PNG and spec files exist.
- **What the gate covers:**
  - All mobile screens.
  - Card 6.0 (the app shell: tab bar, theme, tokens) is gated by D0 and D2.
  - Cards 4.2 and 4.3 change the **desktop** app. They are exempt from this gate and go through the existing desktop `ui-verify` workflow.

## Flow of Phases 0 and 1

1. On `mobile/phase-1` (created from `dev`): **0.D first** (docs re-aligned, its own commit) → 0.D2 (tokens, its own commit) → 0.0 → 0.T.
2. On `spike/mobile` (created from `mobile/phase-1`): spikes 0.1–0.5, the device session, then 0.6.
3. Back on `mobile/phase-1`: 1.0 → 1.1 → 1.2 → 1.3 → 1.7a → 1.7 → 1.4 → 1.5 → 1.5b → 1.6, with 1.8 after 1.7 and 1.9 alongside.

Then a Sonnet `/code-review` on the phase diff, and you merge `mobile/phase-1` into `dev` through a pull request.

## Stretches

A **stretch** is one background run of the orchestrator. It contains only work that needs nothing from the user: **no phone, no dev server,
no browser, no question**. It ends at a fixed point, or earlier on any stop condition. This section replaces the short stretch table in `PLAN.md` §6.

### Stretch A — setup and spike code

- **Starts from:** the checkout on `dev`, with no modified tracked files.
- **Does, in this order:**
  1. Creates the branch `mobile/phase-1` from `dev`.
  2. WP0.D — docs re-aligned. One commit.
  3. WP0.D2 — tokens moved to `tokens.css`. One commit.
  4. WP0.0 — commits the card files and the ignore rules. One commit.
  5. WP0.T — hooks. One commit.
  6. Creates the branch `spike/mobile` from `mobile/phase-1`.
  7. WP0.1–0.5, **code only**: writes the throwaway app in `spikes/mobile/` with its four test pages and measurement scripts, and runs `./gradlew assembleDebug` once. One commit on `spike/mobile`.
- **Ends when:** step 7 is committed. The checkout is left on `spike/mobile`.
- **Does NOT do:**
  - anything on a phone (`adb`, `cap run`, installing the app, measurements);
  - start a dev server or open a browser;
  - any Phase 1 card (WP1.0 and later);
  - merge, push, or touch `dev` and `master`.
- **Stops early if:** a card escalates; `npm run verify` fails twice on the same card; free disk is under 6 GB before the Gradle build; Gradle names a missing SDK package; anything is not covered by a card.
- **Result:** 4 commits on `mobile/phase-1`, 1 commit on `spike/mobile`, a debug APK built, and a report of at most 150 words plus the status table.

### After stretch A, with the user present

- **Browser check for WP0.D2:** the app is opened in the three themes and each token's computed value is compared with `dev`. This needs a dev server, so it is not part of a background run.
- **Stretch B — device session:** the user plugs in the phone; the spike app is installed and the four measurements run (see `phase-0/WP0.1-0.5-spikes.md`, "Device session").
- **Stretch C — WP0.6:** results drafted by Sonnet, go/no-go decided by Opus.
- **Stretch D — Phase 1:** WP1.0 → WP1.6, WP1.8, WP1.9 on `mobile/phase-1`. Its bounds are written here before it starts.

## Status

| Card                  | Model                        | State | Commit  | Notes                                                                                                                                                                                    |
| --------------------- | ---------------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0.D                 | sonnet                       | done  | ad9d7fe | verify green. Worker reports style.css and tokens.css differ in 9 names, not only 2 lines (D2 to check). Dead code noted: plans reorder store fns, `.wcs-status*`, `.btn-danger-action`. |
| WP0.D2                | sonnet                       | done  | 1e035b7 | verify green. Browser token check still pending (needs dev server, user present).                                                                                                        |
| WP0.0                 | haiku                        | done  | fe61ea6 | verify green.                                                                                                                                                                            |
| WP0.T                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP0.1-0.5 spikes code | sonnet                       | todo  |         |                                                                                                                                                                                          |
| Device session        | orchestrator                 | todo  |         |                                                                                                                                                                                          |
| WP0.6                 | sonnet draft + Opus decision | todo  |         |                                                                                                                                                                                          |
| WP1.0                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.1                 | haiku                        | todo  |         |                                                                                                                                                                                          |
| WP1.2                 | haiku                        | todo  |         |                                                                                                                                                                                          |
| WP1.3                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.7a                | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.7                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.4                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.5                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.5b                | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.6                 | haiku                        | todo  |         |                                                                                                                                                                                          |
| WP1.8                 | sonnet                       | todo  |         |                                                                                                                                                                                          |
| WP1.9                 | haiku                        | todo  |         |                                                                                                                                                                                          |
