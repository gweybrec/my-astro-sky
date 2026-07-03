---
name: frontend-feature
description: >
  Guide for implementing a purely frontend feature: UI panels, modals, widgets,
  canvas overlays, or CSS changes. Enforces UI guidelines, CSS token usage,
  component reuse, i18n across all four languages, frontend error logging, and
  the project's definition of done (tests + build).
  Trigger phrases: "frontend feature", "add UI", "new panel", "new modal",
  "new component", "new widget", "UI change", "frontend only", "add a button",
  "add a toggle", "update the sidebar".
---

# Frontend Feature Development

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each test covers.
- Any logic that is not DOM manipulation must be tested: pure functions, algorithms, data transformations, state helpers, utilities.
- If no unit test changes are needed, the plan must **state the justification** (e.g. "all changes are DOM-only event handlers with no extractable pure logic").
- Identifying tests is part of the plan, not an afterthought. A plan that omits this section is incomplete.

Tests live in `tests/unit/`. Run with `npm test`.

**For frontend features, ask:** Does this introduce or modify any pure function, projection helper, sorting/filtering logic, or data transformation? If yes → tests required.

---

## Step 1 — Search before you write

Before creating anything new, grep for existing implementations. The codebase has
many reusable widgets, helpers, and CSS classes — adding a duplicate creates debt.

```bash
# Find existing patterns related to your concept
grep -r "your-concept" src/ --include="*.ts" -l
grep -r "your-concept" src/style.css
```

Key files to check:

- `src/ui.ts` — all panel/modal/widget construction; reuse helpers where possible
- `src/style.css` — existing classes; never add a new class without checking for a match
- `src/i18n/fr.ts` — existing translation keys (avoid duplicate keys)

---

## Step 2 — CSS & styling rules

**Always use CSS tokens. Never use raw hex, rgba, or hardcoded colours.**

Tokens are defined in `:root` in `src/style.css`. Full list in `docs/dev/ui-guidelines.md`.

| Category    | Key tokens                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Backgrounds | `--bg-app`, `--bg-deep`, `--bg-modal`, `--bg-panel`, `--bg-card`, `--bg-input`, `--bg-surface`, `--bg-hover` |
| Text        | `--text-primary`, `--text-secondary`, `--text-label`, `--text-dim`, `--text-muted`, `--text-bright`          |
| Borders     | `--border-panel`, `--border-input`, `--border-subtle`, `--border-accent`, `--border-focus`                   |
| Accent      | `--accent-bg`, `--accent-bg-hover`, `--accent-border`, `--accent-color`                                      |

**Typography:** section headers 13px/600/0.05em letter-spacing; body/labels 13px; secondary 12px; chips 11px; tiny 10px. Use the system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`).

**No inline styles for reused patterns.** If `style.cssText` sets the same property in more than one place, extract it to a CSS class. Inline styles are acceptable only for dynamic per-instance values (e.g. transform matrices, positions computed at runtime).

---

## Step 3 — Reuse component classes

Check these before adding a new class:

| What you need         | Reuse                                                        |
| --------------------- | ------------------------------------------------------------ |
| Primary action button | `.btn-primary` or `.add-photo-btn-top`                       |
| Icon-only button      | `.btn-icon`                                                  |
| Toolbar toggle button | `.display-controls-btn`                                      |
| Confirm / submit      | `.modal-submit`                                              |
| Cancel / dismiss      | `.modal-cancel`                                              |
| Auto-solve / pick-map | `.btn-auto-solve`, `.btn-pick-map`                           |
| Text input            | `.star-search-input`, `.radec-input`, `.dialog-input`        |
| Number input in a row | `.display-controls-number-input`                             |
| Tag / chip            | `.tag-chip`                                                  |
| Type label chip       | `.search-item-type`, `.target-card-type`                     |
| Info panel            | `.dso-info-panel`                                            |
| Target card           | `.target-card`                                               |
| Modal backdrop        | `.modal-backdrop`                                            |
| Modal container       | `.modal`, `.modal-header`, `.modal-body`                     |
| Overlay (full-screen) | `.meta-editor-overlay`, `.dialog-overlay`                    |
| Collapsible section   | `.sidebar-section`, `.modal-panel`; or `<details>/<summary>` |

**Known consolidation opportunities** (address when touching nearby code, not proactively):

- Multiple button classes do the same thing → `btn-confirm` / `btn-action` is the target
- `.targets-coord-input` and `.targets-date-input` are identical → should merge

---

## Step 4 — Internationalization

Every user-facing string must use `t('key')`. Add the key to **all four** files:

```
src/i18n/fr.ts   ← primary (French)
src/i18n/en.ts
src/i18n/de.ts
src/i18n/es.ts
```

Pattern:

```typescript
// In fr.ts
mySection: {
  myKey: 'Texte en français',
}

// In the component
import { t } from './i18n';
label.textContent = t('mySection.myKey');
```

Never pass a raw string literal to a UI element — always go through `t()`.

---

## Step 5 — Frontend error logging

All caught errors **must** call `reportUnknownRendererError` from `src/error-reporter.ts`.
Do not silently swallow errors or log only to `console.error`.

```typescript
import { reportUnknownRendererError } from './error-reporter';

try {
  await someApiCall();
} catch (err) {
  reportUnknownRendererError('my_feature_action', err, { photoId, dsoId });
  // then handle the UI fallback
}
```

- `category`: short snake_case string identifying the operation (e.g. `'photo_upload'`, `'dso_load'`, `'placement_save'`)
- `context`: optional extra data to help diagnose the error
- This is a no-op outside Electron — safe for browser dev mode

---

## Step 6 — Browser verification

Ask the user before running Playwright:

> "Should I run Playwright browser tests to verify the UI, or will you test it yourself?"

**If the user wants automated verification:**

1. Start the dev server: `npm run dev` (Vite port 5173 + Express port 3001)
2. Navigate: `browser_navigate` to `http://localhost:5173`
3. Take a snapshot: `browser_snapshot` to confirm layout
4. Take a screenshot: `browser_take_screenshot` to visually confirm
5. Exercise the golden path: click through the new feature
6. Check console: `browser_console_messages` — zero unhandled errors

**If the user prefers to test manually:** summarise what to test in 3–5 bullet points.

---

## Step 7 — Common checks

Before considering the task done:

- [ ] Unit tests written/updated in `tests/unit/` for any new logic
- [ ] `npm run test` passes (no failures, no skips for new code)
- [ ] `npm run build` passes (zero TypeScript errors)
