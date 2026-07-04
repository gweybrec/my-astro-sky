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

A lean workflow. The detailed UI reference is chunked under `docs/dev/ui/` — **read the relevant
chunk on demand** (don't pull all of it up front):

- `docs/dev/ui-guidelines.md` — hub: CSS architecture decision tree + shortcuts cheat-sheet
- `docs/dev/ui/tokens.md` — colour / spacing / typography / radius / z-index tokens
- `docs/dev/ui/components.md` — component catalog (buttons, modals, inputs, chips, icons, FOV controls…)
- `docs/dev/ui/patterns.md` — layout constants, panel-row utilities, input hints, known issues

---

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each covers.
- Any logic that is not DOM manipulation must be tested: pure functions, algorithms, data
  transformations, state helpers, utilities.
- If no unit test changes are needed, **state the justification** (e.g. "all changes are DOM-only
  event handlers with no extractable pure logic").
- A plan that omits this section is incomplete.

Tests live in `tests/unit/`. Run with `npm test`. **Ask:** does this introduce or modify any pure
function, projection helper, sorting/filtering logic, or data transformation? If yes → tests required.

---

## Step 1 — Search before you write

The codebase has many reusable widgets, helpers, and CSS classes — a duplicate is debt. Before
creating anything new, grep:

```bash
grep -rn "your-concept" src/ --include="*.ts" --include="*.vue"
```

Key places to check first:

- `src/ui.ts` — panel/modal/widget construction helpers (`makeSection`, `makeCheckRow`, `positionPopup`…)
- `uno.config.ts` — shortcuts (named component classes) — reuse before inventing
- `src/i18n/fr.ts` — existing translation keys (avoid duplicates)
- `docs/dev/ui/components.md` — which class already covers your widget

---

## Step 2 — CSS & styling rules

**Never hardcode a `hex`, `rgba()`, or `px` value. Never use `style=` in Vue templates.** Follow the
decision tree in `docs/dev/ui-guidelines.md`:

1. Single-element spacing/color/flex/layout → **UnoCSS atomic utility** (`ml-4`, `text-primary`, `flex`, `gap-2`, `hidden`…)
2. Repeated multi-property pattern → **add a shortcut** to `uno.config.ts`, use it as a class
3. Pseudo-element / `@keyframes` / canvas selector / sibling combinator → `src/styles/canvas.css`
4. New design token → `src/styles/tokens.css` **and** the `uno.config.ts` theme (kept in sync)

Most-used shortcuts: `btn-action`, `btn-confirm`, `btn-cancel`, `btn-danger`, `btn-icon`,
`input-base`, `tag-chip`, `status-{success,error,info,warn}`. Modals reuse `.modal-backdrop` /
`.modal` / `.modal-header` / `.modal-body`. For the full inventory and per-component contracts, read
`docs/dev/ui/components.md`; for token names, `docs/dev/ui/tokens.md`.

---

## Step 3 — Internationalization

Every user-facing string uses `t('key')`. Add the key to **all four** files:

```
src/i18n/fr.ts   ← primary (French)
src/i18n/en.ts
src/i18n/de.ts
src/i18n/es.ts
```

```typescript
// fr.ts
mySection: { myKey: 'Texte en français' }

// component
import { t } from './i18n';
label.textContent = t('mySection.myKey');
```

Never pass a raw string literal to a UI element — always go through `t()`.

---

## Step 4 — Frontend error logging

All caught errors **must** call `reportUnknownRendererError` from `src/error-reporter.ts`. Do not
silently swallow errors or log only to `console.error`.

```typescript
import { reportUnknownRendererError } from './error-reporter';

try {
  await someApiCall();
} catch (err) {
  reportUnknownRendererError('my_feature_action', err, { photoId, dsoId });
  // then handle the UI fallback
}
```

- `category`: short snake_case identifying the operation (`'photo_upload'`, `'dso_load'`, …)
- `context`: optional extra data to help diagnose
- No-op outside Electron — safe in browser dev mode

---

## Step 5 — Browser verification

Ask first: _"Should I run Playwright browser tests to verify the UI, or will you test it yourself?"_

**If automated:** `npm run dev` → `browser_navigate` to `http://localhost:5173` → `browser_snapshot`
+ `browser_take_screenshot` → exercise the golden path → `browser_console_messages` (zero unhandled
errors). Note the theme trap: a fresh profile loads `cold-blue-v2`; pin `localStorage['app-theme'] =
'warm'` before verifying amber-token colours (see `docs/dev/ui/components.md` §2.1).

**If manual:** summarise what to test in 3–5 bullets.

---

## Step 6 — Definition of done

- [ ] Unit tests written/updated in `tests/unit/` for any new logic
- [ ] `npm run test` passes (no failures, no skips for new code)
- [ ] `npm run build` passes (zero TypeScript errors)
