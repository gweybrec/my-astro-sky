# UI Guidelines — Design Tokens

> ← Back to [UI Guidelines](../ui-guidelines.md)

Every colour, spacing value, size, radius, and z-index used in the app must trace back to a token
defined here. **Never hardcode a raw `hex`, `rgba()`, or `px` value** — reference a token via a
UnoCSS utility, a shortcut, or `var(--token)`.

---

## 1. Design Tokens

### 1.1 Colour palette

All variables are defined in **`src/styles/tokens.css`** (`:root`) and mirrored into the
`uno.config.ts` theme — that pair is the single source of truth. The default theme is warm amber on
near-void black; the `cold-blue-v2` theme re-tints most of these tokens.

> **Why no literal values below?** Colour tokens are theme-dependent — `[data-theme='cold-blue-v2']`
> in `src/style.css` overrides them — so any hex/rgba printed here would be true for only one theme
> and would drift from the source. Read the actual values from `src/styles/tokens.css`; the tables
> here document each token's **semantic role** (pick by intent, not by colour).

#### Backgrounds

| Token                | Where used                             |
| -------------------- | -------------------------------------- |
| `--bg-app`           | `html, body`                           |
| `--bg-deep`          | Loading overlay, full-screen backdrops |
| `--bg-modal`         | Modal and batch-modal `background`     |
| `--bg-panel`         | Side panel                             |
| `--bg-card`          | Target cards, targets form             |
| `--bg-input`         | All text inputs, selects, textareas    |
| `--bg-surface`       | Inline data panels, suggest lists      |
| `--bg-hover`         | Hovered list items, search results     |
| `--bg-overlay`       | Modal/dialog backdrops                 |
| `--bg-overlay-heavy` | Full-screen gallery overlays           |
| `--bg-dropdown`      | Search dropdowns                       |
| `--bg-panel-hdr`     | Modal-panel header backgrounds         |
| `--bg-surface-lo`    | Lighter surface variant                |
| `--bg-surface-mid`   | Mid surface variant                    |
| `--bg-warm-hover`    | Hover on dark buttons                  |
| `--bg-warm-hover2`   | Secondary hover variant                |
| `--bg-warm-hover3`   | Tertiary hover variant                 |
| `--bg-warm-btn`      | Button base fills                      |
| `--bg-overlay-72`    | Mid-weight overlay                     |
| `--bg-code`          | Code block background                  |
| `--bg-code-dark`     | Pre/code dark tint                     |
| `--bg-clear-btn`     | Clear/reset button base                |
| `--bg-clear-hover`   | Clear/reset button hover               |

#### Borders

| Token               | Where used                             |
| ------------------- | -------------------------------------- |
| `--border-panel`    | Panel edges, card borders              |
| `--border-input`    | All inputs                             |
| `--border-subtle`   | List-item separators, section dividers |
| `--border-accent`   | Primary action buttons                 |
| `--border-focus`    | `:focus` state on all inputs           |
| `--border-chrome`   | Structural chrome dividers             |
| `--border-white-xs` | Ultra-subtle hairline                  |
| `--border-white-sm` | Subtle border                          |
| `--border-white-md` | Mid-weight border                      |
| `--border-white-lg` | Visible border                         |
| `--border-white-xl` | Strong border                          |

#### Text

| Token              | Use                                             |
| ------------------ | ----------------------------------------------- |
| `--text-primary`   | Body text, input values                         |
| `--text-secondary` | Photo names, secondary labels                   |
| `--text-label`     | Section headers, checkbox labels, slider labels |
| `--text-dim`       | Instructions, placeholders, hints               |
| `--text-muted`     | Pagination info, form hints                     |
| `--text-bright`    | Highlighted names, DSO names, tooltips          |

> **Rule:** never use a raw hex or rgba() for text. Pick the nearest token.

#### Brand accent (amber)

The `--accent-fill-*` family is an intentional **opacity ramp** (subtle → bold) of the same accent
hue — pick by strength, not by colour.

| Token               | Use                                                  |
| ------------------- | ---------------------------------------------------- |
| `--accent-bg`       | Primary action button fills                          |
| `--accent-bg-hover` | Primary action button hover                          |
| `--accent-border`   | Accent-coloured border (alias of `--accent-fill-xl`) |
| `--accent-color`    | `accent-color` on checkboxes/ranges                  |
| `--accent-danger`   | `accent-color` for destructive inputs                |
| `--color-danger`    | Icon/text colour for destructive actions             |
| `--accent-fill-sm`  | Subtle amber tint                                    |
| `--accent-fill-md`  | Light amber fill                                     |
| `--accent-fill-lg`  | Medium amber fill                                    |
| `--accent-fill-xl`  | Strong amber fill                                    |
| `--accent-fill-2xl` | Bold amber fill                                      |

#### Shadows

Shadows are near-black at increasing opacity; pick by elevation level.

| Token          | Use                           |
| -------------- | ----------------------------- |
| `--shadow-sm`  | Shallow elevation (dropdowns) |
| `--shadow-md`  | Standard elevation            |
| `--shadow-lg`  | Modals                        |
| `--shadow-xl`  | Heavy modals                  |
| `--shadow-2xl` | Full-screen overlays          |

Always use `box-shadow: 0 Ypx Zpx var(--shadow-*)` — the geometry (offset, blur) can be hardcoded
in the box-shadow shorthand; only the color must be a token.

#### Status colours

Each semantic has a matching `-bg` / `-border` / `-text` token trio.

| Semantic       | Background token      | Border token              | Text token              |
| -------------- | --------------------- | ------------------------- | ----------------------- |
| Success        | `--status-success-bg` | `--status-success-border` | `--status-success-text` |
| Error          | `--status-error-bg`   | `--status-error-border`   | `--status-error-text`   |
| Info / solving | `--status-info-bg`    | `--status-info-border`    | `--status-info-text`    |
| Warning        | `--status-warn-bg`    | `--status-warn-border`    | `--status-warn-text`    |

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
> `--filter-name-text`, and `--filter-name-border` tokens to `tokens.css` and a `.filter-name` class.

#### FOV frame overlay colours

These tokens drive Canvas 2D rendering. They are defined in `tokens.css` but read via
`getComputedStyle` at render time — Canvas 2D contexts do not support CSS `var()` directly.

| Token                | Where used               |
| -------------------- | ------------------------ |
| `--fov-frame-stroke` | FOV frame dashed outline |
| `--fov-frame-label`  | FOV frame text label     |

---

### 1.2 Spacing scale

All tokens are in `tokens.css`. **Zero hardcoded pixel values** are permitted outside `:root` for
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
> (e.g. component-specific `max-height`, `min-width` clamps) add a new token to `tokens.css` before
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
