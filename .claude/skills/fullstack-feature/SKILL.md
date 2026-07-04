---
name: fullstack-feature
description: >
  Guide for implementing a feature that adds or modifies both API routes
  (server/index.ts) and frontend UI. Combines all frontend rules with backend
  conventions: Swagger annotations on every route, backend error logging, and
  swagger regeneration.
  Trigger phrases: "fullstack feature", "new API route", "add endpoint",
  "new route", "backend + frontend", "API + UI", "new backend feature",
  "add a server route", "new express route".
---

# Fullstack Feature Development

This skill covers features that touch both `server/index.ts` (Express routes) and
`src/` (frontend). For purely frontend changes, see `[[frontend-feature]]`.

---

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each test covers.
- Any logic that is not DOM manipulation or Express boilerplate must be tested: pure functions, data transformations, parsers, DB helpers, algorithm changes.
- If no unit test changes are needed, the plan must **state the justification** (e.g. "route only proxies data with no transformation logic").
- Identifying tests is part of the plan, not an afterthought. A plan that omits this section is incomplete.

Tests live in `tests/unit/`. Run with `npm test`.

**For fullstack features, ask:** Does this introduce or modify any parsing, validation, transformation, or utility logic — on the server or client side? If yes → tests required.

---

## Part A — Frontend rules

Follow all steps from `[[frontend-feature]]` for any UI work. In brief:

1. **Search before you write** — grep `src/ui.ts` and `uno.config.ts` for reusable widgets and shortcut classes
2. **CSS tokens only** — every token lives in `src/styles/tokens.css` (mirrored into the `uno.config.ts` theme); reference via UnoCSS utilities/shortcuts or `var(--…)`, never raw hex/rgba/px
3. **Reuse component classes** — buttons (`btn-action`, `btn-confirm`, `btn-cancel`, `btn-danger`, `btn-icon` shortcuts), inputs (`input-base`, `.dialog-input`, `.star-search-input`), modals (`.modal-backdrop`, `.modal`, `.modal-header`, `.modal-body`), chips (`tag-chip`), collapsibles (`.sidebar-section`, `<details>`) — full inventory in `docs/dev/ui/components.md`
4. **i18n** — every user-facing string via `t('key')`; add to all four files: `src/i18n/fr.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`
5. **Frontend error logging** — all caught errors call `reportUnknownRendererError(category, err, context?)` from `src/error-reporter.ts`; never silently swallow

---

## Part B — Backend: Swagger annotations

Every new or modified route in `server/index.ts` **must** have a `@swagger` JSDoc block.

### Required fields

| Field         | Rule                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `summary`     | Short title (≤ 10 words)                                                                                                    |
| `parameters`  | Every path/query param: `in`, `name`, `required`, `schema.type`, `description`                                              |
| `requestBody` | For POST/PUT/PATCH: full `content: application/json` schema with all properties, types, and descriptions                    |
| `responses`   | `200` with response schema + **every error code the handler can return** (400, 404, 500) with `description` and error shape |

### Template

```typescript
/**
 * @swagger
 * /api/my-resource/{id}:
 *   post:
 *     summary: Create a new my-resource
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID of the parent resource
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name (max 255 characters)
 *               value:
 *                 type: number
 *                 description: Numeric value
 *     responses:
 *       200:
 *         description: Created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       404:
 *         description: Parent resource not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [RESOURCE_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.post('/api/my-resource/:id', async (req, res) => { ... });
```

---

## Part C — Backend: error logging

All caught errors in route handlers must log before responding with an HTTP error:

```typescript
app.get('/api/my-resource/:id', async (req, res) => {
  try {
    // ...
  } catch (err) {
    console.error('[MyResource] Failed to fetch resource', err);
    res.status(500).json({ error: 'Server error' });
  }
});
```

- Use the bracket prefix pattern `[Category]` consistent with existing handlers
- Log the full error object (not just `err.message`) so stack traces appear in the console
- Uncaught exceptions and unhandled rejections in the Electron main process are captured automatically by `setupErrorLogging()` in `electron/error-logger.ts` — do not add redundant top-level handlers

---

## Part D — Regenerate Swagger

After adding or modifying any route annotation:

```bash
npm run swagger:generate
```

This rebuilds `public/swagger.json` from all `@swagger` blocks in `server/*.ts`.
Verify the file was updated (check its `git diff`) before considering the task done.

---

## Part E — Common checks

Before considering the task done:

- [ ] Unit tests written/updated in `tests/unit/` for any new logic
- [ ] `npm run test` passes (no failures, no skips for new code)
- [ ] `npm run build` passes (zero TypeScript errors)
- [ ] Ask the user: "Should I run Playwright browser tests to verify the UI, or will you test it yourself?"
  - If yes: `npm run dev`, `browser_navigate` to `http://localhost:5173`, snapshot + screenshot + console check
  - If no: summarise what to verify in 3–5 bullet points
