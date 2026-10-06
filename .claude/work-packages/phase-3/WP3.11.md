# WP3.11 — Remove the one-line re-export files

Model: sonnet · Branch: `mobile/phase-3b` · Depends on: WP3.10 · Needs device: no · Needs browser: no (the orchestrator checks the app in a browser afterwards)

## Goal

When a module moved to a shared package, a one-line file stayed at its old path (`export * from '@myastrosky/core/…'`) so that nothing else had to change. There are now about 80 of them in `src/` and `server/` (65 before WP3.9 and WP3.10, plus theirs). They hide where code lives and let a test mock the wrong module. Rewrite every import to the real path and delete them. **Mechanical; no behaviour changes.**

## Steps

1. **List them** with a script (keep it in the scratchpad, not in the repository): every file of `src/` and `server/` whose content, comments aside, is only `export * from '@myastrosky/<package>/<path>'` and/or `export { default } from '…'`. Print the list with each target. Files that re-export **and** add something (a wrapper function, as `src/density-slider.ts` or `src/frame-controller.ts` may after WP3.9) are not in the list and stay.
2. **Rewrite the imports** with the same script, in `src/`, `server/`, `tests/`, `electron/`, `scripts/` and inside `.vue` files: every `import … from`, `export … from`, dynamic `import()`, `vi.mock(`, `vi.doMock(`, `vi.importActual(` and `vi.importMock(` whose path resolves to a listed file becomes the listed target. Resolve paths properly (relative to the importing file, with and without extension, `src/i18n` meaning `src/i18n/index.ts`); do not use a plain text replacement of names.
3. **Mocks need a second look, one by one** (the script prints them; about 30): a `vi.mock` on the old path replaced the re-export module; on the new path it replaces the real module for everyone, including modules inside the package. That is the intended effect, but check each test still passes and still tests what its name says. A test that mocks a core module by a relative path into `packages/core/src/` (`tests/unit/dso-catalog.test.ts:10`) is rewritten to the `@myastrosky/core/…` form.
4. **Delete the listed files** (`git rm`).
5. **Keep it so**: in `eslint.config.js`, a rule at **error** for `src/**`, `server/**` and `tests/**` forbidding a file whose only statements are re-exports of an `@myastrosky/*` module (`no-restricted-syntax` on `ExportAllDeclaration` with such a source is enough, with the files of step 1 that legitimately add something exempted by name). Check `npm run lint` exits with 0.
6. **Guides.** `packages/core/CLAUDE.md` says tests import through the re-exports: replace that by "import core modules as `@myastrosky/core/<name>` everywhere". Same sentence where `tests/CLAUDE.md`, `src/CLAUDE.md` or `docs/dev/mobile-architecture.md` mention the re-export files. `vitest.config.ts` coverage excludes that name deleted files are cleaned.

## Must NOT

- Change anything but import paths, mock paths, the deletions, the lint rule and the guides.
- Reformat files beyond what Prettier does to the changed lines.

## Escalate if

- A test fails after the rewrite for a reason other than its mock path, and the cause is not a plain path mistake.
- The production build output changes in size by more than 1 % (compare `dist/` total size before and after; a difference would mean something other than paths changed).

## Commit

`internal(refactor): import shared modules by their real path and delete the re-export files`

## Check by the orchestrator, after the commit (browser, isolated data)

As at the end of `WP3.4.md`: map with no console error, Targets tab lists targets, gallery opens, settings window opens, language switch to English and back. Screenshots in `.playwright-mcp/phase3b-check/`.

## Report, in addition to the common items

The number of files deleted per folder · the number of import lines rewritten per area · every mock rewritten, with the test's result · files kept because they add something · `dist/` size before and after.
