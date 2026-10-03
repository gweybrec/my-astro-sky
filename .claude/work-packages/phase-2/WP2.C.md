# WP2.C — Lighter grey for the object-type badge on the desktop (with the user present)

Model: sonnet · Depends on: stretch E finished · Needs device: no · **Needs browser: yes**

## Goal

On 2026-10-04 the user accepted a lighter grey for the text of the object-type badge on mobile, and said it can be applied to the desktop too
**if it improves contrast there**. Measure it on the desktop in every theme, make the one-line change, and produce before/after pictures. The
user decides from the pictures. **This card does not commit.**

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Context

- The badge is `.target-card-type` in `src/style.css` (near line 4016). Its text colour is `var(--text-dim)`. It is created in
  `src/targets-view.ts` in three places.
- The proposed colour is `var(--text-secondary)`.
- Read first: `src/CLAUDE.md` ("Before adding CSS"), `.claude/skills/ui-verify/SKILL.md`.

## Steps

1. Check that ports 5173 and 3001 are free. If they are busy, stop and report. Start the app with an isolated database and uploads folder
   (`DB_PATH` and `UPLOADS_DIR` pointing to a new temp folder, set for that command only), never the user's own data. Record the PID.
2. Open the Targets tab so that target cards with a type badge are visible. If it needs a gear setup or a location, create them in the isolated
   database through the app.
3. **Before**, in every theme the theme selector offers: read the computed text colour of `.target-card-type` and the colour actually behind
   it (composite the badge background over the card and panel backgrounds; do not assume opaque colours), compute the WCAG contrast ratio, and
   take a screenshot zoomed on two or three cards. Save to `.playwright-mcp/type-badge/<theme>-before.png`.
4. Change `color: var(--text-dim)` to `color: var(--text-secondary)` in the `.target-card-type` rule. Nothing else.
5. **After**, same themes, same cards, same zoom: ratios and screenshots (`<theme>-after.png`).
6. Check the badge next to its neighbours (the constellation badge, the object id): it must not become louder than the object's name. Say what
   you see.
7. Stop the server you started (full process tree, by PID) and confirm both ports are free.

## Must NOT

- Commit, stage or push. Leave the one-line change in the working tree.
- Change any other rule, token or file.
- Use the user's database or uploads. Kill a process you did not start.

## Acceptance

- A table: theme, ratio before, ratio after, for every theme.
- Before and after screenshots for every theme, same framing.
- No console errors.
- Ports 5173 and 3001 free at the end.

## Escalate if

- The ports are busy.
- The ratio gets worse in a theme, or `--text-secondary` is not defined in a theme.

## Always forbidden

- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.

## Report

The ratio table · the screenshot paths · what step 6 showed · the exact diff · whether the server is stopped.
