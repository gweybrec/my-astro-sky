# UI/UX Guidelines

Design reference for MyAstroSky's front-end. Every colour, spacing value, size, and interactive
pattern used in the app must trace back to this document.

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

> **Zero-tolerance rule:** Never use a raw `hex`, `rgba()`, or `px` value in templates or new CSS rules — always reference a token via a utility, shortcut, or `var(--token)`.

---

## 1. Design Tokens

### 1.1 Colour palette

All variables are defined in `:root` at the top of `src/style.css`. The theme is warm amber
on near-void black — all backgrounds and text are warm-tinted, never blue-grey.

#### Backgrounds

| Token                | Value                      | Where used                             |
| -------------------- | -------------------------- | -------------------------------------- |
| `--bg-app`           | `#080808`                  | `html, body`                           |
| `--bg-deep`          | `#111111`                  | Loading overlay, full-screen backdrops |
| `--bg-modal`         | `#0e0c0a`                  | Modal and batch-modal `background`     |
| `--bg-panel`         | `rgba(14, 12, 10, 0.96)`   | Side panel                             |
| `--bg-card`          | `rgba(20, 18, 14, 0.9)`    | Target cards, targets form             |
| `--bg-input`         | `rgba(22, 20, 16, 0.85)`   | All text inputs, selects, textareas    |
| `--bg-surface`       | `rgba(22, 20, 16, 0.45)`   | Inline data panels, suggest lists      |
| `--bg-hover`         | `rgba(192, 120, 48, 0.08)` | Hovered list items, search results     |
| `--bg-overlay`       | `rgba(0, 0, 0, 0.7)`       | Modal/dialog backdrops                 |
| `--bg-overlay-heavy` | `rgba(0, 0, 0, 0.88)`      | Full-screen gallery overlays           |
| `--bg-dropdown`      | `rgba(12, 11, 9, 0.98)`    | Search dropdowns                       |
| `--bg-panel-hdr`     | `rgba(18, 16, 12, 0.80)`   | Modal-panel header backgrounds         |
| `--bg-surface-lo`    | `rgba(22, 20, 16, 0.40)`   | Lighter surface variant                |
| `--bg-surface-mid`   | `rgba(22, 20, 16, 0.50)`   | Mid surface variant                    |
| `--bg-warm-hover`    | `rgba(28, 26, 20, 0.90)`   | Hover on dark buttons                  |
| `--bg-warm-hover2`   | `rgba(35, 32, 26, 0.70)`   | Secondary hover variant                |
| `--bg-warm-hover3`   | `rgba(32, 30, 24, 0.85)`   | Tertiary hover variant                 |
| `--bg-warm-btn`      | `rgba(22, 20, 16, 0.60)`   | Button base fills                      |
| `--bg-overlay-72`    | `rgba(0, 0, 0, 0.72)`      | Mid-weight overlay                     |
| `--bg-code`          | `rgba(30, 28, 22, 0.60)`   | Code block background                  |
| `--bg-code-dark`     | `rgba(0, 0, 0, 0.25)`      | Pre/code dark tint                     |
| `--bg-clear-btn`     | `rgba(32, 28, 22, 0.80)`   | Clear/reset button base                |
| `--bg-clear-hover`   | `rgba(45, 40, 32, 0.80)`   | Clear/reset button hover               |

#### Borders

| Token               | Value                       | Where used                             |
| ------------------- | --------------------------- | -------------------------------------- |
| `--border-panel`    | `rgba(255, 255, 255, 0.07)` | Panel edges, card borders              |
| `--border-input`    | `rgba(255, 255, 255, 0.09)` | All inputs                             |
| `--border-subtle`   | `rgba(255, 255, 255, 0.04)` | List-item separators, section dividers |
| `--border-accent`   | `rgba(192, 120, 48, 0.45)`  | Primary action buttons                 |
| `--border-focus`    | `rgba(192, 120, 48, 0.65)`  | `:focus` state on all inputs           |
| `--border-chrome`   | `#333`                      | Structural chrome dividers             |
| `--border-white-xs` | `rgba(255, 255, 255, 0.06)` | Ultra-subtle hairline                  |
| `--border-white-sm` | `rgba(255, 255, 255, 0.08)` | Subtle border                          |
| `--border-white-md` | `rgba(255, 255, 255, 0.15)` | Mid-weight border                      |
| `--border-white-lg` | `rgba(255, 255, 255, 0.20)` | Visible border                         |
| `--border-white-xl` | `rgba(255, 255, 255, 0.40)` | Strong border                          |

#### Text

| Token              | Value     | Use                                             |
| ------------------ | --------- | ----------------------------------------------- |
| `--text-primary`   | `#e0d8cf` | Body text, input values                         |
| `--text-secondary` | `#a09080` | Photo names, secondary labels                   |
| `--text-label`     | `#7a7068` | Section headers, checkbox labels, slider labels |
| `--text-dim`       | `#5a5048` | Instructions, placeholders, hints               |
| `--text-muted`     | `#4a4038` | Pagination info, form hints                     |
| `--text-bright`    | `#f0e8df` | Highlighted names, DSO names, tooltips          |

> **Rule:** never use a raw hex or rgba() for text. Pick the nearest token.

#### Brand accent (amber)

| Token               | Value                       | Use                                      |
| ------------------- | --------------------------- | ---------------------------------------- |
| `--accent-bg`       | `rgba(192, 120, 48, 0.55)`  | Primary action button fills              |
| `--accent-bg-hover` | `rgba(210, 135, 55, 0.75)`  | Primary action button hover              |
| `--accent-border`   | alias of `--accent-fill-xl` | Accent-coloured border                   |
| `--accent-color`    | `rgba(192, 120, 48, 0.9)`   | `accent-color` on checkboxes/ranges      |
| `--accent-danger`   | `rgba(200, 70, 70, 0.85)`   | `accent-color` for destructive inputs    |
| `--color-danger`    | `#c77`                      | Icon/text colour for destructive actions |
| `--accent-fill-sm`  | `rgba(192, 120, 48, 0.12)`  | Subtle amber tint                        |
| `--accent-fill-md`  | `rgba(192, 120, 48, 0.20)`  | Light amber fill                         |
| `--accent-fill-lg`  | `rgba(192, 120, 48, 0.35)`  | Medium amber fill                        |
| `--accent-fill-xl`  | `rgba(192, 120, 48, 0.50)`  | Strong amber fill                        |
| `--accent-fill-2xl` | `rgba(192, 120, 48, 0.60)`  | Bold amber fill                          |

#### Shadows

| Token          | Value                | Use                           |
| -------------- | -------------------- | ----------------------------- |
| `--shadow-sm`  | `rgba(0, 0, 0, 0.4)` | Shallow elevation (dropdowns) |
| `--shadow-md`  | `rgba(0, 0, 0, 0.5)` | Standard elevation            |
| `--shadow-lg`  | `rgba(0, 0, 0, 0.6)` | Modals                        |
| `--shadow-xl`  | `rgba(0, 0, 0, 0.7)` | Heavy modals                  |
| `--shadow-2xl` | `rgba(0, 0, 0, 0.8)` | Full-screen overlays          |

Always use `box-shadow: 0 Ypx Zpx var(--shadow-*)` — the geometry (offset, blur) can be hardcoded
in the box-shadow shorthand; only the color must be a token.

#### Status colours

| Semantic       | Background token      | Border token              | Text token                       |
| -------------- | --------------------- | ------------------------- | -------------------------------- |
| Success        | `--status-success-bg` | `--status-success-border` | `--status-success-text` (`#8c8`) |
| Error          | `--status-error-bg`   | `--status-error-border`   | `--status-error-text` (`#c88`)   |
| Info / solving | `--status-info-bg`    | `--status-info-border`    | `--status-info-text` (`#99c`)    |
| Warning        | `--status-warn-bg`    | `--status-warn-border`    | `--status-warn-text` (`#fd9`)    |

#### Astrophotography filter colours

Filter chips have fixed semantic colours tied to the wavelength/filter type. They must look
**identical wherever they appear**.

| Filter        | Background token  | Text token             | Border token             |
| ------------- | ----------------- | ---------------------- | ------------------------ |
| L (Luminance) | `--filter-l`      | `--filter-l-text`      | `--filter-l-border`      |
| R (Red)       | `--filter-r`      | `--filter-r-text`      | `--filter-r-border`      |
| G (Green)     | `--filter-g`      | `--filter-g-text`      | `--filter-g-border`      |
| B (Blue)      | `--filter-b`      | `--filter-b-text`      | `--filter-b-border`      |
| RGB           | `--filter-rgb`    | `--filter-rgb-text`    | `--filter-rgb-border`    |
| Hα (H-alpha)  | `--filter-ha`     | `--filter-ha-text`     | `--filter-ha-border`     |
| OIII          | `--filter-oiii`   | `--filter-oiii-text`   | `--filter-oiii-border`   |
| SII           | `--filter-sii`    | `--filter-sii-text`    | `--filter-sii-border`    |
| Custom        | `--filter-custom` | `--filter-custom-text` | `--filter-custom-border` |

> Never hard-code a filter colour. If a new filter type is added, add `--filter-name`,
> `--filter-name-text`, and `--filter-name-border` tokens to `:root` and a `.filter-name` class.

#### FOV frame overlay colours

These tokens drive Canvas 2D rendering. They are defined in `:root` but read via `getComputedStyle`
at render time — Canvas 2D contexts do not support CSS `var()` directly.

| Token                | Value                     | Where used               |
| -------------------- | ------------------------- | ------------------------ |
| `--fov-frame-stroke` | `rgba(220, 60, 60, 0.85)` | FOV frame dashed outline |
| `--fov-frame-label`  | `rgba(220, 90, 90, 0.9)`  | FOV frame text label     |

---

### 1.2 Spacing scale

All tokens are in `:root`. **Zero hardcoded pixel values** are permitted outside `:root` for
any `padding`, `margin`, `gap`, `width`, `height`, `line-height`, or `border-radius` property.

#### Core scale (2 px steps)

| Token        | Value  | Typical use                      |
| ------------ | ------ | -------------------------------- |
| `--space-px` | `1px`  | Single-pixel offsets             |
| `--space-1`  | `2px`  | Hairline separators, icon gaps   |
| `--space-2`  | `4px`  | Tight padding, inline gaps       |
| `--space-3`  | `6px`  | Chip padding, small gaps         |
| `--space-4`  | `8px`  | Standard gap — most common       |
| `--space-5`  | `10px` | Input padding, list-item padding |
| `--space-6`  | `12px` | Component inner padding          |
| `--space-7`  | `16px` | Modal header/body padding        |
| `--space-8`  | `20px` | Panel outer padding              |
| `--space-9`  | `24px` | Section separation               |
| `--space-10` | `28px` | Large component gap              |
| `--space-11` | `32px` | Generous padding                 |
| `--space-12` | `36px` | Panel section padding            |
| `--space-13` | `40px` | Large section gap                |
| `--space-14` | `48px` | Hero/display padding             |

#### Fine-grained half-steps

| Token         | Value  |
| ------------- | ------ |
| `--space-1h`  | `3px`  |
| `--space-2h`  | `5px`  |
| `--space-3h`  | `7px`  |
| `--space-4h`  | `9px`  |
| `--space-6h`  | `14px` |
| `--space-7h`  | `18px` |
| `--space-8h`  | `22px` |
| `--space-10h` | `30px` |

#### Large layout spacing

| Token        | Value   |
| ------------ | ------- |
| `--space-15` | `52px`  |
| `--space-16` | `56px`  |
| `--space-17` | `60px`  |
| `--space-18` | `64px`  |
| `--space-19` | `80px`  |
| `--space-20` | `84px`  |
| `--space-21` | `100px` |

#### Structural layout offsets

| Token                         | Value   | Use                                    |
| ----------------------------- | ------- | -------------------------------------- |
| `--panel-width`               | `280px` | Side-panel fixed width                 |
| `--targets-gear-label-offset` | `130px` | Gear-row label indent in Targets panel |

> **Rule:** never use a raw px value for any spacing, size, or layout property. Pick the nearest
> token. For negative margins use `calc(-1 * var(--space-N))`. For values truly not on the scale
> (e.g. component-specific `max-height`, `min-width` clamps) add a new token to `:root` before
> using it.

---

### 1.3 Typography scale

Three font families:

| Token            | Stack                                        | Use                                    |
| ---------------- | -------------------------------------------- | -------------------------------------- |
| `--font-display` | `'Cormorant Garamond', Georgia, serif`       | Display headings, gallery titles       |
| `--font-mono`    | `'DM Mono', 'Consolas', 'Monaco', monospace` | Coordinate values, code, search inputs |
| `--font-ui`      | `'Outfit', system-ui, sans-serif`            | All other UI text                      |

#### Font-size scale

| Token                 | Value  | Use                         |
| --------------------- | ------ | --------------------------- |
| `--font-size-pico`    | `8px`  | Ultra-compact labels        |
| `--font-size-nano`    | `9px`  | Near-invisible micro labels |
| `--font-size-micro`   | `10px` | Uppercase micro labels      |
| `--font-size-small`   | `11px` | Chips, metadata labels      |
| `--font-size-base`    | `12px` | Secondary body, inputs      |
| `--font-size-body`    | `13px` | Primary body, buttons       |
| `--font-size-sub`     | `14px` | Modal titles, card titles   |
| `--font-size-title`   | `15px` | Card headers                |
| `--font-size-head`    | `16px` | Modal/panel main headers    |
| `--font-size-large`   | `18px` | Side-panel section titles   |
| `--font-size-section` | `20px` | Section display labels      |
| `--font-size-xl`      | `24px` | Large display values        |
| `--font-size-symbol`  | `28px` | Icon-like symbol sizes      |
| `--font-size-display` | `48px` | Hero display text           |

Section headers use `font-size: var(--font-size-body); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase`.

---

### 1.4 Border-radius scale

| Token           | Value   | Use                                          |
| --------------- | ------- | -------------------------------------------- |
| `--radius-xs`   | `2px`   | Ultra-small rounding                         |
| `--radius-1h`   | `3px`   | Fine rounding                                |
| `--radius-sm`   | `4px`   | Inputs, small buttons                        |
| `--radius-2h`   | `5px`   | Mid-fine rounding                            |
| `--radius-md`   | `6px`   | Cards, modals, dropdowns                     |
| `--radius-lg`   | `8px`   | Larger panels, batch cards                   |
| `--radius-xl`   | `10px`  | Prominent components                         |
| `--radius-2xl`  | `12px`  | Large featured components                    |
| `--radius-pill` | `999px` | Circular buttons, info icons, full-pill tags |

---

### 1.5 Z-index scale

| Token         | Value   | Use                                  |
| ------------- | ------- | ------------------------------------ |
| `--z-base`    | `1`     | Normal stacking                      |
| `--z-panel`   | `10`    | Side panel                           |
| `--z-toggle`  | `11`    | Panel toggle tab                     |
| `--z-sidebar` | `20`    | Sidebar z-context                    |
| `--z-modal`   | `200`   | Modal backdrop + content             |
| `--z-meta`    | `210`   | Metadata editor (above `.modal`)     |
| `--z-gallery` | `220`   | Gallery detail overlay               |
| `--z-tooltip` | `10000` | Floating tooltips (above everything) |

---

### 1.6 Gallery layout

| Token                  | Value  | Use                            |
| ---------------------- | ------ | ------------------------------ |
| `--gallery-hero-max-h` | `70vh` | Gallery hero image max height  |
| `--gallery-card-gap`   | `40px` | Gap between gallery grid cards |

---

### 1.7 Utilities

#### `.hidden`

```css
.hidden {
  display: none !important;
}
```

Use `classList.add/remove/toggle('hidden')` to show and hide elements from TypeScript. **Never set `el.style.display` directly.**

```ts
el.classList.add('hidden'); // hide
el.classList.remove('hidden'); // show
el.classList.toggle('hidden', !visible); // conditional
```

Exception: elements that need to restore to `display: flex` or `display: inline-flex` when shown. In those cases a context-specific class (e.g. `.fov-row` which already defines `display: flex`) handles the non-`block` default, so removing `.hidden` restores the correct value automatically. Only write explicit `style.display` when no class can provide the default.

---

## 2. Component Catalog

For each component: **purpose** (what it is for), **behaviour** (interaction contract),
**CSS classes** (what to reuse), **do not** (anti-patterns to avoid).

---

### 2.1 Buttons

Five semantic roles. Map your intent to a role, then use the corresponding class.

| Role                   | Target class _(future)_ | Current class(es)                                                                                                               | Appearance                    | When                                                                              |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| **Confirm / primary**  | `btn-confirm`           | `.modal-submit`, `.manual-validate-btn`, `.meta-editor-save`, `.batch-start-btn`, `.dialog-btn-primary`, `.dso-editor-save-btn` | Green filled                  | Main positive action in a modal footer                                            |
| **Action / navigate**  | `btn-action`            | `.add-photo-btn-top`, `.btn-primary`, `.btn-auto-solve`, `.btn-pick-map`                                                        | Amber filled                  | Panel primary action, open map, trigger solver                                    |
| **Cancel / secondary** | `btn-cancel`            | `.modal-cancel`, `.manual-cancel-btn`, `.meta-editor-cancel`, `.dialog-btn-cancel`                                              | Dim/transparent               | Dismiss, go back                                                                  |
| **Ghost**              | `.display-controls-btn` | `.display-controls-btn`                                                                                                         | Transparent with hover border | Compact panel controls                                                            |
| **Icon-only**          | `.btn-icon`             | `.btn-icon`                                                                                                                     | Square, no label              | Per-item controls in lists                                                        |
| **Danger — dialog**    | `btn-danger`            | `.dialog-btn-danger`, `.gear-popup-delete-btn`                                                                                  | Full red                      | Destructive action that **replaces** a dialog confirm (irreversible, modal-level) |
| **Danger — inline**    | —                       | `.btn-danger-action`                                                                                                            | Dark red, lower contrast      | Destructive action inside a form alongside other buttons (e.g. "Reset all")       |

> **Danger button disambiguation:** use `.dialog-btn-danger` when the button is the sole
> destructive choice in a confirmation dialog. Use `.btn-danger-action` for secondary destructive
> actions inside a form footer where a confirm button also exists.

> **Trash / delete icons must be red.** Any icon-only button that deletes or removes something
> uses the trash SVG (`src/icons/trash.svg`) and the danger colour — `.btn-icon--danger` for a
> `.btn-icon`, or the equivalent `--color-danger` styling. Never use a plain `✕`/`×` cross for a
> destructive per-item action; that glyph is reserved for non-destructive dismiss/close controls.

> **Migration note:** until the `btn-confirm` / `btn-cancel` / `btn-action` classes are created
> and the old classes removed, keep using the existing class for the component you are editing.
> Do **not** introduce new button class variants.

#### Icon button active / toggle state

An icon-only button that toggles a persistent state (e.g. the **anchor** button in the
_Field of View Frames_ popup) has an official pressed/on look:

| State   | Class                       | Appearance                                                                                              |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Off** | `btn-icon`                  | The plain icon button                                                                                   |
| **On**  | `btn-icon btn-icon--active` | Amber tint fill (`--accent-fill-lg`) + accent border (`--border-focus`) + bright icon (`--text-bright`) |

Rules:

- **Never** dim the off state with `opacity-*` to signal "off" — off is simply the normal
  button. The on state is what carries the visual cue.
- The icon SVG must use `currentColor` so `--active` recolors it via `text-bright`.
- Reflect the state with `aria-pressed="true|false"` on the button.

This reuses the same amber-tint-fill + `--border-focus` active convention already used by the
`.active` modifiers on pagination, language, hemisphere, and mirror buttons — keeping every
toggle in the app visually consistent.

---

### 2.2 Modals

**Purpose:** Display a large body of content **or** collect user input that requires focused
attention. Use when the interaction cannot fit in a small floating panel.

**Behaviour contract:**

- The backdrop (`--bg-overlay`) does **not** close the modal — clicking outside does nothing.
- A **×** close button (`class="modal-close"`) is always present in `.modal-header`.
- The Escape key closes modals that have no unsaved form state.
- Long content scrolls inside `.modal-body` (overflow: auto); the header and footer stay fixed.
- Footer action buttons go in `.modal-footer`, right-aligned.

**CSS classes:**

| Class                                  | Role                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `.modal-backdrop`                      | Full-screen overlay (z: `--z-modal`, bg: `--bg-overlay`)                                   |
| `.modal`                               | Content box (flex-column, max 90vw / 85vh, bg: `--bg-modal`) — **required on every modal** |
| `.modal-header`                        | Title + close button row                                                                   |
| `.modal-body`                          | Scrollable content                                                                         |
| `.modal-footer`                        | Action buttons row (flex, right-aligned)                                                   |
| `.modal-footer-grid2`                  | Two-column equal-width footer (cancel / confirm side by side)                              |
| `.modal-close`                         | × button in header                                                                         |
| `.modal-panel` / `.modal-panel-header` | Collapsible sub-section inside a modal body                                                |

#### Modal sizing variants

Add one sizing class alongside `.modal` to constrain width and height. Never set `max-width` or `max-height` inline.

| Class                     | Max-width | Max-height | Use                                          |
| ------------------------- | --------- | ---------- | -------------------------------------------- |
| _(none)_                  | 960 px    | 85 vh      | Full-size modals (batch upload, light-solve) |
| `.settings-modal`         | 460 px    | —          | Settings, solver config                      |
| `.settings-modal--flex`   | 460 px    | 85 vh      | Settings with a scrollable body section      |
| `.settings-modal--scroll` | 460 px    | 80 vh      | Settings with very long scrollable content   |
| `.import-modal`           | 400 px    | —          | Import / export                              |
| `.missing-modal`          | 420 px    | 70 vh      | Missing-files report                         |
| `.gear-custom-modal`      | 440 px    | 90 vh      | Gear preset editor                           |

#### Modal body layout variants

Pair one body class with `.modal-body` to control inner padding and gap.

| Class                      | Padding            | Gap              | Use                                 |
| -------------------------- | ------------------ | ---------------- | ----------------------------------- |
| `.modal-form-body`         | `var(--space-7)`   | `var(--space-4)` | Standard form layout                |
| `.modal-form-body--loose`  | `var(--space-7)`   | `var(--space-6)` | Wide-spaced form (about, credits)   |
| `.modal-form-body--scroll` | `var(--space-6/7)` | `var(--space-5)` | Scrollable body inside a flex modal |

**Variant — confirmation dialog:**
For simple yes/no prompts (≤ 2 sentences + 2 buttons), use `.dialog-overlay` / `.dialog`
instead. These **do** close on backdrop click (Escape key also works).

**Do not:**

- Close a modal on backdrop click.
- Put a modal inside another modal.
- Use a modal just to display a small info blurb — use a Click Tooltip (§2.4) instead.
- Set `max-width`, `max-height`, or `display: flex` inline on a modal — use the sizing variants above.

---

### 2.3 Hover Tooltip

**Purpose:** Show a small read-only data panel while the user hovers over a sky-map element
(star, DSO) or a UI element with a `title`-style annotation.

**Behaviour contract:**

- Appears on `mouseenter` / `mousemove`. Dismisses automatically on `mouseleave`.
- **No user action required** to open or close.
- Contains only read-only data (tables, names, magnitudes). No interactive elements.

**CSS class:** `#tooltip` — singleton element managed by the sky map callbacks.

**Do not:**

- Put buttons, links, or inputs inside a hover tooltip.
- Re-implement hover-tooltip logic; use `skyMap.setOnStarHover()` / `setOnDSOHover()`.

---

### 2.4 Click Tooltip

**Purpose:** Show a small read-only panel on demand. Anchored near its trigger. Stays open
until the user dismisses it.

**Behaviour contract:**

- **One click** on the trigger → panel opens (anchored near trigger).
- **Click outside** the panel → panel closes.
- **Click trigger again** while open → panel closes (toggle).
- Contains read-only data and may include simple action buttons (e.g. navigate, copy).
- **No form inputs** (`<input>`, `<select>`, `<textarea>`).
- No title bar, no close button.
- Max-width ~400px; compact padding (`--space-7`).

**CSS class:** `.hints-info-tooltip` (position: fixed, z: `--z-tooltip`, bg: `--bg-modal`)

**Do not:**

- Put form inputs inside a click tooltip.
- Inline the tooltip creation logic — always use `showKeyValueTooltip()` or
  `showTextTooltip()` from `src/tooltip-utils.ts`.

---

### 2.5 Info Icon

**Purpose:** A small ⓘ affordance that opens a Click Tooltip (§2.4) with contextual help
for the adjacent widget.

**Visual spec:**

- 16 × 16 px, `border-radius: var(--radius-pill)`, `display: inline-flex; align-items: center; justify-content: center`
- Content: letter "i", `font-weight: bold`, `font-size: var(--font-size-small)`
- Border: `1.5px solid var(--hints-info-icon-border)`
- Hover: scale(1.1), border: `var(--border-focus)`
- CSS class: `.hints-info-icon`

**Do not:**

- Open a modal from an info icon — always open a Click Tooltip.
- Use inline CSS to style an info icon — always use `.hints-info-icon`.

---

### 2.6 Inputs

#### Visual base (all input types share)

| Property      | Value                           |
| ------------- | ------------------------------- |
| Background    | `var(--bg-input)`               |
| Border        | `1px solid var(--border-input)` |
| Color         | `var(--text-primary)`           |
| Border-radius | `var(--radius-sm)`              |
| Focus border  | `var(--border-focus)`           |
| Font-size     | `var(--font-size-base)`         |
| Padding       | `var(--space-3) var(--space-4)` |

#### Labels

- Always place the label **above** or **to the left** of its input.
- Font-size: `var(--font-size-small)`, color: `var(--text-label)`.
- Mandatory fields: append `<span class="required-star"> *</span>` coloured `var(--status-error-text)`.

#### Validation / error state

Triggered when the user attempts to save a form with an invalid field:

1. Add class `.input-error` to the `<input>` element.
   - `.input-error` sets `border-color: var(--status-error-border)` and `outline: 1px solid var(--status-error-text)`.
2. Insert a `<span class="input-error-msg">` below the input with a short human-readable message.
3. Remove `.input-error` and `.input-error-msg` as soon as the user begins typing in the field again.

> Toast notifications are for async feedback (save success, network error), **not** for
> inline field validation. Use the `.input-error` pattern for form validation.

#### Input CSS classes

| Class                            | Use                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `.star-search-input`             | Full-width search input (padding-right reserved for `.search-clear-btn`)            |
| `.tag-input`                     | Metadata editor text fields (DSO IDs, labels, notes)                                |
| `.notes-textarea`                | Multi-line textarea in metadata editor                                              |
| `.radec-input`                   | Fixed-width (90 px) coordinate field                                                |
| `.radec-input-small`             | Flex, centred — for DMS sub-fields                                                  |
| `.targets-coord-input`           | Targets-form date/coord fields _(identical to `.targets-date-input` — merge these)_ |
| `.display-controls-number-input` | Number spinner in display panel                                                     |
| `.dialog-input`                  | Input inside a generic `.dialog`                                                    |

Number inputs: use the `.no-spinner` class to hide browser up/down arrows where the default
browser widget is undesirable.

Autocomplete inputs: wrap in `.tag-input-wrap`; suggestions appear in `.tag-suggest`.

---

### 2.7 Checkboxes (Standard)

- Styled via `accent-color: var(--accent-color)`.
- Always wrapped in a `<label>` so the label text is also a click target.
- Use `.dso-toggle-label` on the `<label>` for checkbox rows inside panels.
- Use the `makeCheckRow()` helper in `src/ui.ts` for any new display/settings toggle.

---

### 2.8 Select-All Checkbox (Tristate)

Placed above a list of individual checkboxes to control them all. Three visual states:

| List state               | Visual                                                   | Click result                                                                 |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **All checked**          | ✓ checked                                                | Uncheck all — trigger the "unchecked" callback for every item                |
| **Mixed** (some checked) | — indeterminate (amber background, white horizontal bar) | Check all — trigger the "checked" callback for every **unchecked** item only |
| **None checked**         | □ unchecked                                              | Check all — trigger the "checked" callback for every item                    |

**Implementation rules:**

- When mixed: set `checkbox.indeterminate = true` and `checkbox.checked = false`.
  (`indeterminate` controls the visual; `checked` controls the logical state when indeterminate is cleared.)
- Do not trigger callbacks for items already in the target state (avoids double-firing).
- Keep indeterminate state in sync whenever any individual checkbox changes.

Current uses: export modal (photo list), labels dropdown, conflict resolution modal.

---

### 2.9 Selects / Native Dropdowns

- Use a native `<select>` styled with `--bg-input` background and `--border-input` border.
- For options that require coloured badges (e.g. integration filter types), use the custom
  Chip Input widget (§2.10 below) instead — `<option>` elements cannot be styled cross-browser.

---

### 2.10 Chips / Badges

Chips appear in three distinct flavours. Do not mix them.

#### Filter chips (semantic)

Fixed identity and colour tied to the astrophotography filter type. Must look **identical
wherever they appear** in the app.

| Filter        | CSS class        | Colour token      |
| ------------- | ---------------- | ----------------- |
| L (Luminance) | `.filter-l`      | `--filter-l`      |
| R (Red)       | `.filter-r`      | `--filter-r`      |
| G (Green)     | `.filter-g`      | `--filter-g`      |
| B (Blue)      | `.filter-b`      | `--filter-b`      |
| RGB           | `.filter-rgb`    | `--filter-rgb`    |
| Hα (H-alpha)  | `.filter-ha`     | `--filter-ha`     |
| OIII          | `.filter-oiii`   | `--filter-oiii`   |
| SII           | `.filter-sii`    | `--filter-sii`    |
| Custom        | `.filter-custom` | `--filter-custom` |

> **Rule:** always create filter chips via `createFilterBadge(name)` from `src/chip-utils.ts`.
> Never apply a `.filter-*` class or colour inline. If a new filter type is added, add both
> a `--filter-name` variable in `:root` and a `.filter-name` CSS class.

#### User / entity chips (removable)

Created dynamically when the user types in a chip input (see below). Each carries a × remove button.

| Class                  | Colour                                | Use                                    |
| ---------------------- | ------------------------------------- | -------------------------------------- |
| `.tag-chip`            | Amber-outlined                        | DSO ID attached to a photo             |
| `.tag-chip.label-chip` | Green                                 | User-defined label attached to a photo |
| `.tag-chip-sm`         | _(bug: missing bg/colour — fix this)_ | Compact variant for the photo list     |

> **The remove `×` is always a `.tag-chip-remove` button** — never an ad-hoc utility-class
> button. `.tag-chip-remove` gives the dim glyph + danger-red hover that every removable chip
> shares. A chip's full anatomy is exactly: `<span class="tag-chip">` → label text →
> `<button class="tag-chip-remove">×</button>`. Reproduce this markup identically whether you
> build it in a Vue template (e.g. `MetadataEditorPanel.vue`) or via `document.createElement`
> in a `.ts` file (e.g. the mosaic-edit popup in `fov-overlay.ts`).
>
> **Do not** re-style the chip with one-off utilities (`border-[var(--border-accent)]`,
> `text-label`) or replace the remove button with hand-rolled classes
> (`leading-none text-muted hover:text-bright`). The `.tag-chip` / `.tag-chip-remove` CSS pair
> in `style.css` is the single source of truth; overriding it is how duplicate, drifting chip
> widgets get created.

#### Type / category badges (read-only display)

No remove button. Display only.

| Class                | Use                                                    |
| -------------------- | ------------------------------------------------------ |
| `.search-item-type`  | Star (gold) or DSO (blue) badge in search dropdowns    |
| `.target-card-type`  | DSO type badge on a target result card                 |
| `.targets-type-chip` | Filter chip in the targets form (filled when selected) |

#### Chip Input widget

An input field that converts typed text into a chip on selection. The produced chips sit
above or beside the input.

| Element             | Class               |
| ------------------- | ------------------- |
| Outer wrapper       | `.tag-input-wrap`   |
| Text input          | `.tag-input`        |
| Suggestion dropdown | `.tag-suggest`      |
| Suggestion items    | `.tag-suggest-item` |

Each generated chip gets a × button that removes the chip on click.

Always implement chip inputs using the utilities in `src/chip-utils.ts`. Never re-implement
the pattern inline.

---

### 2.11 Collapsible Sections

Six contexts exist, each with its own classes. Match the context you are in:

| Context             | Header class                   | Content class                  | State class                        |
| ------------------- | ------------------------------ | ------------------------------ | ---------------------------------- |
| Side-panel section  | `.sidebar-section-header`      | `.sidebar-section-content`     | `.collapsed` on `.sidebar-section` |
| Modal sub-panel     | `.modal-panel-header`          | _(body inside `.modal-panel`)_ | `.open` on `.modal-panel`          |
| Add-photo metadata  | `.metadata-toggle`             | `.metadata-section`            | `.open` on `.metadata-section`     |
| Target card details | `<summary>` inside `<details>` | _(browser native)_             | _(browser native)_                 |
| Batch card metadata | `.batch-meta-toggle`           | _(sibling content)_            | `.open` on `.batch-item-card`      |
| Photo list section  | `.photo-section-header`        | `.photo-section-items`         | `.collapsed` on `.photo-section`   |

All chevrons use the `▶` character rotated `90deg` via `transform: rotate(90deg)` when open.
Use `makeSection()` from `src/ui.ts` for any new sidebar section.

---

### 2.12 Cards

Cards are self-contained content blocks with a consistent visual base:
`var(--bg-card)` background, `1px solid var(--border-panel)` border, `var(--radius-md)` radius.

| Class              | Context                                    |
| ------------------ | ------------------------------------------ |
| `.target-card`     | Result card in the Targets view            |
| `.batch-item-card` | Item card in the batch-upload modal        |
| `.dso-info-panel`  | Inline data panel in the side panel        |
| `.photo-section`   | Photo group header + collapsible item list |

---

### 2.13 Search / Autocomplete

| Element                  | Class                                | Notes                                                 |
| ------------------------ | ------------------------------------ | ----------------------------------------------------- |
| Search input             | `.star-search-input`                 | Includes padding-right for clear button               |
| Clear button             | `.search-clear-btn`                  | Absolute-positioned × inside the input wrapper        |
| Results dropdown         | `.search-dropdown`                   | Positioned below input, max-height 220 px, scrollable |
| Result items             | `.search-item`                       | Hover bg: `var(--bg-hover)`                           |
| Metadata suggestion list | `.tag-suggest` + `.tag-suggest-item` | Used inside chip inputs                               |

---

### 2.14 Gear Popup (Photo options)

**Purpose:** Lightweight contextual menu for a single photo item.

**Behaviour:** Opened by clicking the ⚙ button. Closed by clicking anywhere outside — **no
backdrop**. Contains an opacity slider and action buttons. Not a modal; does not block the UI.

| Class                    | Role                                    |
| ------------------------ | --------------------------------------- |
| `.photo-gear-popup`      | Popup container                         |
| `.gear-popup-action-btn` | Standard action button inside the popup |
| `.gear-popup-delete-btn` | Destructive delete button               |

Use `positionPopup()` from `src/ui.ts` to anchor the popup near its trigger.

---

### 2.15 Toast Notifications

**Purpose:** Brief async feedback (save success, import complete, solver error).

```ts
showToast(message: string, type: 'success' | 'error' | 'info')
```

- Auto-dismisses after a timeout.
- CSS class: `.toast` (positioned at top of viewport).
- **Do not** use toasts for inline form validation — use `.input-error` + `.input-error-msg` instead.

---

### 2.16 Spinners / Loading States

Single shared keyframe: `@keyframes loading-spin { to { transform: rotate(360deg); } }`

| Class                 | Size  | Use                            |
| --------------------- | ----- | ------------------------------ |
| `.loading-spinner`    | 36 px | App startup overlay            |
| `.auto-solve-spinner` | 12 px | Inline with solver status text |
| `.targets-spinner`    | 36 px | Targets view loading state     |

---

### 2.17 Lazy Image Loading

**Purpose:** Load images only when they scroll into their container's viewport. Prevents main-thread freezes in the batch upload modal and gallery when many photos are present.

**Pattern:** Build the DOM shell first with no `img.src`. Store the target URL on `img.dataset.src`. Attach an `IntersectionObserver` via `createLazyObserver` from `src/lazy-image.ts`. When an element enters the viewport + `rootMargin` buffer, set `img.src = img.dataset.src`.

```ts
import { createLazyObserver } from './lazy-image';

const observer = createLazyObserver({
  scrollRoot: containerElement, // element with overflow-y: auto
  rootMargin: '400px 0px',
  onVisible: (el) => {
    const img = el.querySelector('img')!;
    img.src = img.dataset.src ?? '';
  },
});
itemElements.forEach((el) => observer.observe(el));
```

**Rules:**

- Call `observer.disconnect()` before rebuilding the item list or on component teardown.
- `scrollRoot` must point to the `overflow-y: auto` container, not `document`.
- Never set `img.src` eagerly when building item shells.

**Current uses:** `Gallery` (`src/gallery.ts` — uses server-generated `thumbFilename` when available, falls back to full-res); batch upload modal (`src/ui.ts` — thumbnails generated off-thread via §2.18).

---

### 2.18 Off-thread Thumbnail Generation

**Purpose:** Resize a local `File` to a small preview JPEG without blocking the main thread. Used in the batch upload modal for files not yet uploaded to the server.

**API:** `generateThumbnail(file: File, maxWidth?: number): Promise<string | null>` from `src/lazy-image.ts`. Returns a blob URL or `null` on failure.

```ts
import { generateThumbnail } from './lazy-image';

const url = await generateThumbnail(file, 240);
if (url) {
  img.src = url;
  // on card removal or modal close: URL.revokeObjectURL(url);
}
```

**Rules:**

- Always revoke blob URLs when the DOM element is removed or the modal is closed.
- The worker is lazily instantiated on first call — no startup cost at module load.
- For photos already on the server, use `/uploads/{thumbFilename}` directly; do not regenerate client-side.

---

### 2.19 Icons

Two tiers. Pick the right tier for each icon; never mix them.

#### Tier 1 — SVG file icons

Used for complex shapes that need a precise visual. All icons live in `src/icons/*.svg`.

**Rules:**

- SVG files must **not** contain `width` or `height` attributes — size is controlled by CSS on the container element.
- All SVG elements use `stroke="currentColor"` (or `fill="currentColor"`) so they inherit the button's text colour.
- Import with Vite's `?raw` suffix and assign to `innerHTML`:

```ts
import trashSvg from './icons/trash.svg?raw';
btn.innerHTML = trashSvg;
```

- **Never** duplicate an SVG string inline in a `.ts` file. Every SVG lives in exactly one `.svg` file.
- If no existing icon fits a new use case, **ask the user** before adding a new file.

**Adding size via CSS** — add an `svg` child rule to the container class:

```css
.my-icon-btn svg {
  width: 16px;
  height: 16px;
}
```

**SVG icon inventory:**

| File                      | Visual                                                 | Container class(es)                                                | CSS size                                                   |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/icons/trash.svg`     | Trash can                                              | `.integration-row-trash`, `.batch-trash-btn`                       | 12 px / 14 px (set per class)                              |
| `src/icons/close-x.svg`   | × (crossing lines)                                     | `.solve-cancel-btn`                                                | 12 px                                                      |
| `src/icons/about.svg`     | Five-pointed star                                      | `.settings-legal-btn`                                              | 16 px                                                      |
| `src/icons/privacy.svg`   | Padlock                                                | `.settings-legal-btn`                                              | 16 px                                                      |
| `src/icons/credits.svg`   | Database cylinder                                      | `.settings-legal-btn`                                              | 16 px                                                      |
| `src/icons/telescope.svg` | Line-art telescope (tube + eyepiece + finder + tripod) | `.fov-telescope-btn`                                               | `var(--font-size-large)` (set by `.fov-telescope-btn svg`) |
| `src/icons/export.svg`    | Box with outgoing up-right arrow                       | `.sky-export-control .sky-rotation-btn`, gallery filter-bar button | 16 px                                                      |
| `src/icons/eye.svg`       | Eye (shown)                                            | `.fov-visibility-btn`, photo-list `.btn-icon` (`PhotoItem.vue`)    | 16 px / `1em`                                              |
| `src/icons/eye-off.svg`   | Eye with slash (hidden)                                | `.fov-visibility-btn`, photo-list `.btn-icon` (`PhotoItem.vue`)    | 16 px / `1em`                                              |

One additional SVG lives as a `data:image/svg+xml` URI in `src/style.css` on `.targets-sort-select` (dropdown caret). It is a pure CSS concern — no TypeScript import needed.

---

#### Tier 2 — Unicode text icons

Used for simple affordances (single character, no precise shape required). Assigned directly as `textContent` — not `innerHTML`.

**Rules:**

- Always use `el.textContent = '⚙'` (not `el.innerHTML = '&#9881;'`) — `textContent` avoids accidental HTML injection.
- The modal-close `×` is the only exception: both `textContent = '×'` and `innerHTML = '&times;'` produce the same character; prefer `textContent`.
- Never introduce a new Unicode icon without adding it to the table below.

**Unicode icon inventory:**

| Character | Unicode | Name                     | Where used                                          |
| --------- | ------- | ------------------------ | --------------------------------------------------- |
| `×`       | U+00D7  | Close / dismiss          | `.modal-close` buttons, chip remove buttons         |
| `⚙`       | U+2699  | Gear / settings          | Panel settings button, per-photo gear button        |
| `↺`       | U+21BA  | Rotate counter-clockwise | Sky-map rotation control                            |
| `↻`       | U+21BB  | Rotate clockwise         | Sky-map rotation control                            |
| `◎`       | U+25CE  | Reset rotation           | Sky-map rotation reset button                       |
| `▾`       | U+25BE  | Chevron / expand         | Sidebar section headers                             |
| `⠿`       | U+28FF  | Drag handle              | Z-order list drag grip                              |
| `−`       | U+2212  | Zoom out                 | Gallery detail viewer                               |
| `+`       | U+002B  | Zoom in                  | Gallery detail viewer                               |
| `⟲`       | U+27F2  | Reset zoom               | Gallery detail viewer                               |
| `✓`       | U+2713  | Success / checked        | Astrometry.net submission badge, hints feedback     |
| `⚠`       | U+26A0  | Warning                  | Error state in loading placeholder                  |
| `i`       | —       | Info                     | `.hints-info-icon` text content                     |
| `◀`       | U+25C0  | Collapse left            | Side panel toggle (closed state), FOV ribbon toggle |
| `▶`       | U+25B6  | Expand right             | Side panel toggle (open state), FOV ribbon toggle   |

> **Note — calendar:** there is no custom calendar icon. Date/datetime fields use `<input type="date">` and `<input type="datetime-local">`, which render a browser-native calendar picker. This is intentional.

---

### 2.20 Status Indicator

**Purpose:** A bordered, coloured row that reflects the current state of an async operation (reading, success, error, warning). Used in the WCS companion panel and the auto-solve flow.

**Base class:** `.wcs-status` — provides shared padding, border-radius, and font-size. Initially hidden.

**State modifier classes (BEM):**

| Modifier               | Colour | When                             |
| ---------------------- | ------ | -------------------------------- |
| `.wcs-status--info`    | Blue   | Reading / processing             |
| `.wcs-status--success` | Green  | Operation completed successfully |
| `.wcs-status--error`   | Red    | Operation failed                 |
| `.wcs-status--warning` | Amber  | Partial success or mismatch      |

**Critical pattern — set the full `className` on every state transition:**

```ts
// ✓ correct — no stale modifiers can accumulate
wcsStatusRow.className = 'wcs-companion-status wcs-status wcs-status--info';

// ✗ wrong — stale modifiers from prior states stay on the element
wcsStatusRow.classList.add('wcs-status--info');
```

Always call `classList.add('hidden')` to hide the row and clear its `innerHTML` before a new operation begins. Expose the show/hide logic through small `showWCSStatus()` / `hideWCSStatus()` helpers so callers never touch the modifier classes directly.

---

### 2.21 Async Content States

When modal content is loaded asynchronously (API call, file read), display one of these placeholder elements while the fetch is in progress, and replace with results or an error on completion.

| Class                        | Text colour           | Use                                                |
| ---------------------------- | --------------------- | -------------------------------------------------- |
| `.modal-loading-placeholder` | `--text-muted`        | Loading spinner + "Loading…" or empty-list message |
| `.modal-loading-error`       | `--status-error-text` | Network or parse error                             |

```ts
// While fetching:
const loading = document.createElement('div');
loading.className = 'modal-loading-placeholder';
loading.innerHTML = '<div class="auto-solve-spinner"></div> Loading…';
content.appendChild(loading);

// On error:
const error = document.createElement('div');
error.className = 'modal-loading-error';
error.textContent = err.message;
content.appendChild(error);
```

**Do not** style loading or error placeholders inline. Never re-use a spinner class (`auto-solve-spinner`, `loading-spinner`) without a wrapping placeholder element.

---

### 2.22 Sky Map Photo Freeze Class

During pan/zoom interactions, photo overlay images are hidden by toggling `.photos-frozen` on `#photo-layer`:

```css
#photo-layer.photos-frozen .photo-overlay-img {
  visibility: hidden;
}
```

`main.ts` adds the class on the first `onViewChange` callback and removes it 100 ms after the last one (debounced). `visibility: hidden` keeps layout intact so transform recomputation still works off-screen.

**Do not** use `display: none` — it breaks the affine matrix recomputation.

---

### 2.23 FOV Ribbon

**Purpose:** A floating, collapsible bar at the bottom-left of the sky map. Houses the telescope-icon popup trigger and 9 parametric rotation step buttons for rotating all FOV frames together.

**CSS container:** `.fov-ribbon` — `position: absolute; left: var(--space-8); bottom: var(--space-8); background: var(--bg-panel)` (same background as the left sidebar).

**Collapsed state:** `.fov-ribbon--collapsed` — hides all `.fov-rotate-btn` children via `display: none`. The telescope button and toggle button remain visible.

**Button anatomy (left to right):**

| Role               | Class                                  | Content                                          |
| ------------------ | -------------------------------------- | ------------------------------------------------ |
| FOV popup trigger  | `.sky-rotation-btn .fov-telescope-btn` | `telescope.svg` inline SVG                       |
| Rotation step (×9) | `.sky-rotation-btn .fov-rotate-btn`    | Parametric SVG from `createRotationIconSvg(deg)` |
| Collapse/expand    | `.sky-rotation-btn .fov-ribbon-toggle` | `◀` (open) / `▶` (collapsed)                     |

**All buttons reuse `.sky-rotation-btn` as their base class** — no new button variant.

**Collapse toggle:** textContent `◀` when open, `▶` when collapsed (same characters as the left panel toggle).

**Disabled state:** all `.fov-rotate-btn` become `disabled` when no setup has `enabled = true`. CSS handles opacity via `.sky-rotation-btn:disabled { opacity: 0.35; cursor: not-allowed; }`.

**Parametric rotation icons:** Generated at runtime by `createRotationIconSvg(deg)` from `src/fov-overlay.ts`. Do **not** create individual SVG files for these — the function takes the degree value and returns an SVG string with arc sweep proportional to |deg|, arrowhead direction reflecting the sign, and the degree text label centred below the arc.

| |deg| | Arc sweep |
|---|---|
| 1° | ~40° |
| 5° | ~90° |
| 15° | ~150° |
| 45° | ~240° |

**State persistence:** `localStorage` key `fov-overlay-v1` via `loadFovState()` / `saveFovState()` from `src/fov-overlay.ts`.

---

### 2.24 FOV Popup

**Purpose:** Lists configured gear setups; allows showing/hiding each setup's FOV frame and adding new setups.

**CSS classes:**

| Class                       | Description                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.fov-popup`                | Root container — `position: fixed`, `background: var(--bg-modal)`, `border-radius: var(--radius-md)` |
| `.fov-popup-header`         | Title + close button row — uppercase 11 px label style                                               |
| `.fov-popup-body`           | Scrollable setup list — `max-height: 300px; overflow-y: auto`                                        |
| `.fov-popup-footer`         | "Add a setup" button — full-width `.btn-primary`                                                     |
| `.fov-popup-select-all-row` | Tristate select-all row (see §2.8 for the tristate pattern)                                          |
| `.fov-popup-setup-row`      | Per-setup row — checkbox + label text + remove `×` button                                            |

**Opened by:** `buildFovPopup()` in `src/fov-overlay.ts`; positioned with `positionPopup()` from `src/ui.ts`. Closes on outside click.

**Empty state:** When `state.setups.length === 0`, the body shows a muted "No setups configured." paragraph instead of the select-all row and setup list.

**"Add a setup" modal:** Opened by `openAddSetupModal()` in `src/fov-overlay.ts`. Uses `buildGearSectionContent()` from `src/targets-view.ts` for zero code duplication with the Targets tab gear section.

**Canvas colour tokens** (read via `getComputedStyle` at render time):

| Token                | Value                     | Where used                                       |
| -------------------- | ------------------------- | ------------------------------------------------ |
| `--fov-frame-stroke` | `rgba(220, 60, 60, 0.85)` | FOV frame outline drawn on the sky map canvas    |
| `--fov-frame-label`  | `rgba(220, 90, 90, 0.9)`  | FOV frame text label drawn on the sky map canvas |

---

### 2.25 Floating Map Controls

**Purpose:** Small action buttons that float over the sky-map canvas corners (rotation, FOV ribbon,
view export). They are not part of the side panel — they sit on top of `#map-container` and are only
shown while the map view is active.

**Shared base class — `.sky-rotation-btn`.** _Every_ floating map-overlay button reuses this single
base: 34 × 34 px, `display: inline-flex`, content centred, `var(--radius-lg)`, `var(--bg-card)`
fill, `var(--accent-border)` border. **Never create a new button variant for a floating control** —
the rotation buttons (§2.23), the FOV ribbon/telescope buttons (§2.23/§2.24), and the export button
all share it. Disabled styling (`opacity: 0.35; cursor: not-allowed`) is built into the base.

**Positioning rules:**

- Each control (or cluster) is wrapped in its own container positioned `position: absolute` against
  a map corner, `z-index: var(--z-toggle)`.
- The horizontal anchor is `right: 298px` — clearing the open side panel. Every right-anchored
  control **must** track the panel collapse with a sibling-combinator rule that shifts it to
  `right: 34px`:
  ```css
  #side-panel.collapsed ~ .sky-export-control {
    right: 34px;
  }
  ```
- Because the sibling combinator cannot be expressed as a utility class, these positioning rules
  live in `src/styles/canvas.css` (per the §CSS-architecture decision tree), **not** in `style.css`
  or as UnoCSS utilities.
- Spacing/offsets use tokens (`var(--space-8)`, etc.) — never raw px.

**Container inventory:**

| Container                | Corner       | Anchor                                         | Holds                                    |
| ------------------------ | ------------ | ---------------------------------------------- | ---------------------------------------- |
| `.sky-rotation-controls` | bottom-right | `right: 298px; bottom: var(--space-8)`         | Rotate ↺ / reset ◎ / ↻                   |
| `.fov-ribbon`            | bottom-left  | `left: var(--space-8); bottom: var(--space-8)` | Telescope popup + rotation steps (§2.23) |
| `.sky-export-control`    | top-right    | `top: var(--space-8); right: 298px`            | View export button                       |

**Icon sizing.** Buttons that render a Unicode glyph size it with `font-size` (the base sets
`var(--font-size-large)`). Buttons that render an **SVG** (`v-html` / `innerHTML`) must constrain it
with an `svg` child rule on the container — the SVG file carries no `width`/`height` (§2.19):

```css
.sky-export-control .sky-rotation-btn svg {
  width: 16px;
  height: 16px;
}
```

A 16 px icon inside the 34 px button gives the padded, inset look shared by the corner controls.

**Mounting:** floating controls render through `FloatingControls.vue`, which `Teleport`s them to
`#app` and only mounts the map cluster when `viewMode === 'skymap'`. Teleporting to `#app` is what
makes them siblings of `#side-panel`, enabling the collapse-tracking combinator above.

**Tooltip suppression:** while hovering/focusing a floating control, call
`uiStore.setForceSuppressTooltip(true/false)` (mirrors `MapRotationControls.vue`) so the sky tooltip
does not flicker behind the button.

**Do not:**

- Introduce a new button class for a floating control — extend `.sky-rotation-btn`.
- Hardcode a right offset without the matching `#side-panel.collapsed ~ …` rule.
- Put positioning rules for these controls in `style.css` or inline `style=`.

---

## 3. Layout Patterns

- **Side panel:** fixed width `var(--panel-width)` (280 px), outer padding `var(--space-8)`.
- **Section gap:** `var(--space-7)` (16 px) between sidebar sections.
- **Component inner gap:** `var(--space-4)` (8 px) between sibling elements inside a component.
- **Modal size:** max-width 960 px / 90 vw; max-height 85 vh.
- **Modal header padding:** `var(--space-7)` (16 px) vertical, `var(--space-8)` (20 px) horizontal.

---

## 4. Panel Labels & Row Utilities

| Class                         | Description                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| `.display-controls-mag-row`   | Flex row for any labelled control (slider, value) inside the panel |
| `.display-controls-mag-label` | Label span inside a `.display-controls-mag-row`                    |
| `.dso-toggle-label`           | `<label>` wrapping a checkbox row inside a panel                   |

Use `display-controls-mag-row` + `display-controls-mag-label` for **any** new labelled
control row in the side panel.

---

## 5. Input Hints

**Never use `placeholder` for example values or default paths.** Placeholders look like real
content and confuse users into thinking the field is already filled.

**Do:** set the `title` attribute on both the `<label>` and the `<input>`:

```ts
lbl.title = 'Full path to the astap_cli binary. Example: /opt/astap/astap_cli';
input.title = 'Full path to the astap_cli binary. Example: /opt/astap/astap_cli';
```

The browser's native tooltip appears on hover — no extra element needed.

---

## 6. Known Issues

Address these when touching the relevant component; do not batch into one giant refactor.

| #   | Issue                                                                      | Action                                                                                                |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | ~~Raw `rgba()` / hex colours throughout `style.css`~~                      | ✓ Resolved — full CSS variable sweep complete                                                         |
| 2   | 26+ button class variants                                                  | Consolidate into `btn-confirm` / `btn-cancel` / `btn-action` / `btn-danger`                           |
| 3   | `.targets-coord-input` and `.targets-date-input` are identical             | Merge into one class                                                                                  |
| 4   | `.tag-chip-sm` has no background or colour                                 | Add `background` and `color` to the class                                                             |
| 5   | ~~Inline `style.cssText` strings in `src/ui.ts`~~                          | ✓ Resolved — eliminated from `ui.ts`, `photo-overlay.ts`, `targets-view.ts`, `solve-status-widget.ts` |
| 6   | `.display-controls-section` and `.dso-section` CSS rules are orphaned      | Delete those rules                                                                                    |
| 7   | Scrollbar override on `.suggest-stars-list` duplicates the global `*` rule | Delete the override                                                                                   |
| 8   | Some modals close on backdrop click (violates §2.2 contract)               | Audit and remove `backdropClose` handlers                                                             |
| 9   | Info icons in Settings use inline CSS instead of `.hints-info-icon`        | Replace with class                                                                                    |
| 10  | ~~Status colours (`rgba(...)` for success/error/info) are not tokenised~~  | ✓ Resolved — all status tokens in `:root`                                                             |
| 11  | ~~Filter badge colours hardcoded per `.filter-*` class~~                   | ✓ Resolved — `--filter-*`, `--filter-*-text`, `--filter-*-border` tokens in `:root`                   |
| 12  | ~~Spacing/font-size/z-index/radius scale not yet in `:root`~~              | ✓ Resolved — full token scale in `:root`                                                              |
| 13  | ~~Wave 2 classes still use raw `rgba()` / `px` values~~                    | ✓ Resolved — full CSS variable sweep complete                                                         |
