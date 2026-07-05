# UI Guidelines — Component Catalog

> ← Back to [UI Guidelines](../ui-guidelines.md) · see also [Design Tokens](tokens.md) · [Layout & Patterns](patterns.md)

For each component: **purpose** (what it is for), **behaviour** (interaction contract),
**CSS classes** (what to reuse), **do not** (anti-patterns to avoid). Section numbers (`§2.x`) are
referenced throughout this page.

---

## 2. Component Catalog

### 2.1 Buttons

Five semantic roles. Map your intent to a role, then use the matching **UnoCSS shortcut** (defined
in `uno.config.ts`). These shortcut classes already exist — use them directly; do **not** invent a
new button variant.

| Role                   | Class (shortcut)        | Appearance                    | When                                                                              |
| ---------------------- | ----------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| **Confirm / primary**  | `btn-confirm`           | Green filled                  | Main positive action in a modal footer                                            |
| **Action / navigate**  | `btn-action`            | Amber filled                  | Panel primary action, open map, trigger solver                                    |
| **Cancel / secondary** | `btn-cancel`            | Dim/transparent               | Dismiss, go back                                                                  |
| **Ghost**              | `.display-controls-btn` | Transparent with hover border | Compact panel controls                                                            |
| **Icon-only**          | `btn-icon`              | Square, no label              | Per-item controls in lists                                                        |
| **Danger — dialog**    | `btn-danger`            | Full red                      | Destructive action that **replaces** a dialog confirm (irreversible, modal-level) |
| **Danger — inline**    | `.btn-danger-action`    | Dark red, lower contrast      | Destructive action inside a form alongside other buttons (e.g. "Reset all")       |

> **Danger button disambiguation:** use `btn-danger` when the button is the sole destructive choice
> in a confirmation dialog. Use `.btn-danger-action` for secondary destructive actions inside a form
> footer where a confirm button also exists.

> **Trash / delete icons must be red.** Any icon-only button that deletes or removes something
> uses the trash SVG (`src/icons/trash.svg`) and the danger colour — `btn-icon--danger` for a
> `btn-icon`, or the equivalent `--color-danger` styling. Never use a plain `✕`/`×` cross for a
> destructive per-item action; that glyph is reserved for non-destructive dismiss/close controls.

> **Legacy aliases still in the tree** — a number of older call-sites hand-roll the same appearance
> under bespoke class names (`.modal-submit`, `.manual-validate-btn`, `.meta-editor-save`,
> `.batch-start-btn`, `.dialog-btn-primary`, `.dso-editor-save-btn`, `.add-photo-btn-top`,
> `.btn-primary`, `.btn-auto-solve`, `.btn-pick-map`, `.modal-cancel`, `.manual-cancel-btn`,
> `.meta-editor-cancel`, `.dialog-btn-cancel`, `.dialog-btn-danger`, `.gear-popup-delete-btn`). When
> you touch one of these, migrate it to the corresponding `btn-*` shortcut rather than adding another
> variant.

#### Icon button states — the one canonical scale

**Every icon-only button in the app shares one state scale. Do not invent per-button colours.**
The single source of truth is the `btn-icon` / `btn-icon--active` shortcut family in
`uno.config.ts`; a handful of pre-existing bespoke classes (listed below) hand-roll the same
values in CSS and **must be kept in lock-step** with it.

The rule that keeps it coherent: **background fill increases monotonically across states, and a
mere hover must never look as "on" as a selected button.** Selected is a persistent, meaningful
state; hover is transient feedback. If a hovered-but-unselected button looks more filled than a
selected one, the scale is inverted — that is a bug.

| State                | Background fill            | Border              | Icon colour      |
| -------------------- | -------------------------- | ------------------- | ---------------- |
| **Off / rest**       | transparent                | `--border-white-md` | `--text-primary` |
| **Off / hover**      | `--accent-fill-lg` (35 %)  | `--border-focus`    | `--text-bright`  |
| **Selected / rest**  | `--accent-bg` (55 %)       | `--border-focus`    | `--text-bright`  |
| **Selected / hover** | `--accent-bg-hover` (75 %) | `--border-focus`    | `--text-bright`  |

Fill progression is therefore **0 → 35 → 55 → 75 %** and must stay in that order. Selected (55 %)
is deliberately stronger than an off-hover (35 %).

**Classes that implement this scale** (touch _all_ of them together, never just one):

- `btn-icon`, `btn-icon--active` (and `--danger` / `--danger-active`) — `uno.config.ts`. The
  default for per-item and modal icon controls.
- `.sky-rotation-btn` — `src/style.css`. The shared base for **every** floating map control
  (rotation, FOV telescope/eye, export, and the sky-time toggle row — see §2.25). Its `.active`
  toggle state lives in `src/styles/canvas.css` (`.sky-time-control .sky-rotation-btn.active`).
- Bespoke momentary icon buttons that predate the shortcut and reuse the same tokens:
  `.panel-settings-btn`, `.modal-close`, `.hints-clear-btn`, `.search-clear-btn`,
  `.gallery-carousel-btn`, `.gallery-zoom-btn` — all in `src/style.css`.

Rules:

- **Never** dim the off state with `opacity-*` to signal "off" — off is simply the normal button
  at rest. The _on_ state carries the visual cue.
- The icon SVG must use `stroke="currentColor"` (or `fill="currentColor"`) so every state recolours
  it automatically. No hardcoded hex/`white` in the SVG.
- Reflect toggle state with `aria-pressed="true|false"` on the button.

This is the same amber-fill + `--border-focus` convention used by the `.active` modifiers on
pagination, language, hemisphere, and mirror buttons — keeping every toggle in the app consistent.

#### Icon SVG stroke weight — normalise for the render size, not the viewBox

An icon's on-screen stroke thickness is `stroke-width × (renderPx / viewBoxSize)`. Two icons with
the **same colour** look nothing alike if one renders a 1.2 px stroke and the other a 0.5 px
hairline — the hairline antialiases to dim grey and reads as a _wrong colour_ even though
`currentColor` is identical. This has bitten us: the 64-unit-viewBox `telescope`/`eye` icons at
`stroke-width="2"` rendered ~0.5 px next to the 24-unit-viewBox `map-pin` at ~1.3 px.

**Target ~1.0–1.3 px on-screen stroke** for all outline icons in floating/panel controls. Compute
the needed `stroke-width` from the icon's viewBox and its render size:

| viewBox | render size | `stroke-width` for ~1.2 px |
| ------- | ----------- | -------------------------- |
| 16      | 16 px       | 1.5                        |
| 24      | 16 px       | 2                          |
| 36      | 18 px       | 2                          |
| 64      | 16–18 px    | 4–5                        |

Do not "fix" a thin icon by brightening its colour — match the stroke weight instead, so it stays
consistent with its neighbours in every state.

#### Verifying icon-button colours — theme-token trap

`src/theme.ts` `loadTheme()` defaults to the **`cold-blue-v2`** theme when `localStorage` has no
`app-theme` key. A fresh browser (including a clean Playwright profile) therefore renders the
steel-blue theme, whose `[data-theme='cold-blue-v2']` block in `src/style.css` overrides
`--accent-*`, `--border-focus`, and the `--text-*` tokens. Amber-token edits then appear to do
nothing. Before verifying icon colours, pin the theme:

```js
localStorage.setItem('app-theme', 'warm');
location.reload();
```

Confirm the change with the element's computed `backgroundColor` / `color`, not by screenshot
alone — the four states must read as four distinct fills (see the scale above).

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

| Class                     | Max-width | Max-height | Use                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none)_                  | 960 px    | 85 vh      | Full-size modals (batch upload, light-solve)                                                                                                                                                                                                                                                                                                                       |
| `.settings-modal`         | 460 px    | —          | Settings, solver config                                                                                                                                                                                                                                                                                                                                            |
| `.settings-modal--flex`   | 460 px    | 85 vh      | Settings with a scrollable body section                                                                                                                                                                                                                                                                                                                            |
| `.settings-modal--scroll` | 460 px    | 80 vh      | Settings with very long scrollable content                                                                                                                                                                                                                                                                                                                         |
| `.import-modal`           | 400 px    | —          | Import / export                                                                                                                                                                                                                                                                                                                                                    |
| `.missing-modal`          | 420 px    | 70 vh      | Missing-files report                                                                                                                                                                                                                                                                                                                                               |
| `.gear-custom-modal`      | 440 px    | 90 vh      | Gear preset editor                                                                                                                                                                                                                                                                                                                                                 |
| `.modal-sheet`            | 95 vw     | 90 vh      | Large summoned surfaces needing room for a wide filter bar + grid (Find-targets overlay). Defined as a `uno.config.ts` shortcut (`!`-marked to win over `.modal`'s own max-width/max-height — `virtual:uno.css` loads before `style.css`), not in `style.css` — new size variants go there per the CSS decision tree. Selectable via `BaseModal`'s `size="sheet"`. |

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

The `input-base` UnoCSS shortcut (`uno.config.ts`) captures this base — prefer it for new text
inputs and selects.

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

| Class                            | Use                                                                      |
| -------------------------------- | ------------------------------------------------------------------------ |
| `.star-search-input`             | Full-width search input (padding-right reserved for `.search-clear-btn`) |
| `.tag-input`                     | Metadata editor text fields (DSO IDs, labels, notes)                     |
| `.notes-textarea`                | Multi-line textarea in metadata editor                                   |
| `.radec-input`                   | Fixed-width (90 px) coordinate field                                     |
| `.radec-input-small`             | Flex, centred — for DMS sub-fields                                       |
| `.targets-coord-input`           | Targets-form date/coord fields                                           |
| `.display-controls-number-input` | Number spinner in display panel                                          |
| `.dialog-input`                  | Input inside a generic `.dialog`                                         |

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
> a `--filter-name` variable in `tokens.css` and a `.filter-name` CSS class.

#### User / entity chips (removable)

Created dynamically when the user types in a chip input (see below). Each carries a × remove button.

| Class                  | Colour         | Use                                    |
| ---------------------- | -------------- | -------------------------------------- |
| `.tag-chip`            | Amber-outlined | DSO ID attached to a photo             |
| `.tag-chip.label-chip` | Green          | User-defined label attached to a photo |
| `.tag-chip-sm`         | Amber-outlined | Compact variant for the photo list     |

> **The remove `×` is always a `.tag-chip-remove` button** — never an ad-hoc utility-class
> button. `.tag-chip-remove` gives the dim glyph + danger-red hover that every removable chip
> shares. A chip's full anatomy is exactly: `<span class="tag-chip">` → label text →
> `<button class="tag-chip-remove">×</button>`. Reproduce this markup identically whether you
> build it in a Vue template (e.g. `MetadataEditorPanel.vue`) or via `document.createElement`
> in a `.ts` file (e.g. the mosaic-edit popup in `fov-overlay.ts`).
>
> **Do not** re-style the chip with one-off utilities (`border-[var(--border-accent)]`,
> `text-label`) or replace the remove button with hand-rolled classes
> (`leading-none text-muted hover:text-bright`). The `.tag-chip` / `.tag-chip-remove` pair
> (shortcuts in `uno.config.ts`) is the single source of truth; overriding it is how duplicate,
> drifting chip widgets get created.

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

| File                      | Visual                                                 | Container class(es)                                                                                 | CSS size                                                   |
| ------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/icons/trash.svg`     | Trash can                                              | `.integration-row-trash`, `.batch-trash-btn`                                                        | 12 px / 14 px (set per class)                              |
| `src/icons/close-x.svg`   | × (crossing lines)                                     | `.solve-cancel-btn`                                                                                 | 12 px                                                      |
| `src/icons/about.svg`     | Five-pointed star                                      | `.settings-legal-btn`                                                                               | 16 px                                                      |
| `src/icons/privacy.svg`   | Padlock                                                | `.settings-legal-btn`                                                                               | 16 px                                                      |
| `src/icons/credits.svg`   | Database cylinder                                      | `.settings-legal-btn`                                                                               | 16 px                                                      |
| `src/icons/telescope.svg` | Line-art telescope (tube + eyepiece + finder + tripod) | `.fov-telescope-btn`                                                                                | `var(--font-size-large)` (set by `.fov-telescope-btn svg`) |
| `src/icons/export.svg`    | Box with outgoing up-right arrow                       | `.sky-export-control .sky-rotation-btn`, gallery filter-bar button                                  | 16 px                                                      |
| `src/icons/eye.svg`       | Eye (shown)                                            | `.fov-visibility-btn`, photo-list `.btn-icon` (`PhotoItem.vue`)                                     | 16 px / `1em`                                              |
| `src/icons/eye-off.svg`   | Eye with slash (hidden)                                | `.fov-visibility-btn`, photo-list `.btn-icon` (`PhotoItem.vue`)                                     | 16 px / `1em`                                              |
| `src/icons/target.svg`    | Reticle: circle + crosshair ticks + filled center dot  | `.find-targets-control .sky-rotation-btn` (map), plan-header `.btn-icon`, empty-state `.btn-action` | 16 px                                                      |

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

**Canvas colour tokens** (read via `getComputedStyle` at render time — values in `tokens.css`):

| Token                | Where used                                       |
| -------------------- | ------------------------------------------------ |
| `--fov-frame-stroke` | FOV frame outline drawn on the sky map canvas    |
| `--fov-frame-label`  | FOV frame text label drawn on the sky map canvas |

---

### 2.25 Floating Map Controls

**Purpose:** Small action buttons that float over the sky-map canvas corners (rotation, FOV ribbon,
view export). They are not part of the side panel — they sit on top of `#map-container` and are only
shown while the map view is active.

**Shared base class — `.sky-rotation-btn`.** _Every_ floating map-overlay button reuses this single
base: 34 × 34 px, `display: inline-flex`, content centred, `var(--radius-lg)`, `var(--bg-card)`
card fill, `var(--border-white-md)` neutral border, `var(--text-primary)` icon. Its hover and
`.active` (selected) states follow the **canonical icon-button scale in §2.1** — do not give it a
bespoke hover/selected colour. **Never create a new button variant for a floating control** — the
rotation buttons (§2.23), the FOV ribbon/telescope buttons (§2.23/§2.24), and the export button all
share it. Disabled styling (`opacity: 0.35; cursor: not-allowed`) is built into the base.

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
  live in `src/styles/canvas.css` (per the CSS-architecture decision tree in the hub), **not** in
  `style.css` or as UnoCSS utilities.
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
