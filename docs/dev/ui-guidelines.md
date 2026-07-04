# UI/UX Guidelines

Design reference for MyAstroSky's front-end. Every colour, spacing value, size, and interactive
pattern used in the app must trace back to this reference.

This page is the **hub**: it holds the CSS architecture rules and a shortcuts cheat-sheet you need
on almost every change, then links out to three detail chapters. Read a chapter only when the task
needs it — that keeps context small for small features.

## Contents

- **[Design Tokens](ui/tokens.md)** — the full colour palette, spacing scale, typography, radius,
  z-index, and utility tokens. Read when you need a specific `var(--…)` value.
- **[Component Catalog](ui/components.md)** — 25 components (buttons, modals, tooltips, inputs,
  chips, cards, icons, FOV controls…): purpose, behaviour contract, which classes to reuse, and the
  anti-patterns to avoid. Read when building or changing a widget.
- **[Layout, Patterns & Known Issues](ui/patterns.md)** — panel/modal layout constants, row-label
  utilities, the input-hints rule, and the live design-debt list.

> These chapters live under `docs/dev/ui/` and are intentionally **not** listed in the sidebar —
> reach them through the links above. Only this hub appears under _Developer Docs_.

---

## CSS architecture

This project uses **UnoCSS** (utility-first, Tailwind-compatible). The file layout:

| File                    | Purpose                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.css` | All CSS custom properties (`:root`). Single source of truth for every colour, spacing, radius, and font-size token. |
| `uno.config.ts`         | UnoCSS theme (maps utilities to token variables), shortcuts (named component classes), and content pipeline config. |
| `src/styles/canvas.css` | Non-atomic residual: `@keyframes`, `::before`/`::after` pseudo-elements, canvas-layer selectors, scrollbars.        |
| `src/style.css`         | Legacy component rules being phased out. Do not add new rules here.                                                 |

### Where to add new styles — decision tree

1. **Spacing, color, flex, layout on a single element** → UnoCSS atomic utility (`ml-4`, `text-primary`, `flex`, `gap-2`, `w-full`, `hidden`, …)
2. **Repeated multi-property pattern used on several elements** → Add a shortcut to `uno.config.ts`. Use it as a class name in templates.
3. **Pseudo-element, `@keyframes`, canvas selector, or sibling combinator** → `src/styles/canvas.css`
4. **New design token** → `src/styles/tokens.css` AND `uno.config.ts` theme (kept in sync). Never hardcode a raw value.

### UnoCSS shortcuts inventory

The most-reused named component classes. Prefer one of these before inventing anything new.

| Shortcut           | Usage                                          |
| ------------------ | ---------------------------------------------- |
| `btn-action`       | Primary accent button (add photo, solve, save) |
| `btn-action--full` | Same, full-width                               |
| `btn-confirm`      | Confirm/submit button in dialogs               |
| `btn-cancel`       | Cancel button in dialogs                       |
| `btn-danger`       | Destructive action button                      |
| `btn-icon`         | Square icon button (eye, gear, ×)              |
| `btn-icon--danger` | Icon button with danger colour                 |
| `input-base`       | All text inputs and selects                    |
| `tag-chip`         | Inline DSO/label chip with border              |
| `tag-chip-sm`      | Small pill chip (targets form badges)          |
| `status-success`   | Green status message                           |
| `status-error`     | Red status message                             |
| `status-info`      | Blue status message                            |
| `status-warn`      | Yellow/amber status message                    |

See [Component Catalog](ui/components.md) for the behaviour and full class inventory behind each.

> **Zero-tolerance rule:** Never use a raw `hex`, `rgba()`, or `px` value in templates or new CSS
> rules — always reference a token via a utility, shortcut, or `var(--token)`. Tokens live in
> `src/styles/tokens.css`.
