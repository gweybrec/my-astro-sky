import { defineConfig } from 'unocss';
import presetWind from '@unocss/preset-wind';

export default defineConfig({
  presets: [presetWind()],

  content: {
    pipeline: {
      include: [/\.(vue|html|[jt]sx?)($|\?)/],
    },
  },

  theme: {
    // Semantic color palette — each maps to a CSS variable from tokens.css.
    // Use as: bg-primary, text-dim, border-subtle, etc.
    colors: {
      // Text colors
      bright: 'var(--text-bright)',
      primary: 'var(--text-primary)',
      secondary: 'var(--text-secondary)',
      label: 'var(--text-label)',
      dim: 'var(--text-dim)',
      muted: 'var(--text-muted)',
      // Surface backgrounds
      app: 'var(--bg-app)',
      deep: 'var(--bg-deep)',
      modal: 'var(--bg-modal)',
      panel: 'var(--bg-panel)',
      card: 'var(--bg-card)',
      surface: 'var(--bg-surface)',
      // Border shades
      subtle: 'var(--border-subtle)',
      focus: 'var(--border-focus)',
      hint: 'var(--text-hint)',
      // Status
      success: 'var(--status-success-bg)',
      error: 'var(--status-error-bg)',
    },

    // Spacing scale — overrides preset defaults so p-4 = var(--space-4) = 8px.
    spacing: {
      px: 'var(--space-px)',
      '1': 'var(--space-1)',
      '1h': 'var(--space-1h)',
      '2': 'var(--space-2)',
      '2h': 'var(--space-2h)',
      '3': 'var(--space-3)',
      '3h': 'var(--space-3h)',
      '4': 'var(--space-4)',
      '4h': 'var(--space-4h)',
      '5': 'var(--space-5)',
      '6': 'var(--space-6)',
      '6h': 'var(--space-6h)',
      '7': 'var(--space-7)',
      '7h': 'var(--space-7h)',
      '8': 'var(--space-8)',
      '8h': 'var(--space-8h)',
      '9': 'var(--space-9)',
      '10': 'var(--space-10)',
      '10h': 'var(--space-10h)',
      '11': 'var(--space-11)',
      '12': 'var(--space-12)',
      '13': 'var(--space-13)',
      '14': 'var(--space-14)',
    },

    // Border-radius scale — use as rounded-sm, rounded-md, rounded-pill, etc.
    borderRadius: {
      xs: 'var(--radius-xs)',
      '1h': 'var(--radius-1h)',
      sm: 'var(--radius-sm)',
      '2h': 'var(--radius-2h)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      '2xl': 'var(--radius-2xl)',
      pill: 'var(--radius-pill)',
      DEFAULT: 'var(--radius-sm)',
    },

    // Font-size scale — use as text-micro, text-body, text-head, etc.
    fontSize: {
      micro: ['var(--font-size-micro)', '1.3'],
      small: ['var(--font-size-small)', '1.4'],
      base: ['var(--font-size-base)', '1.4'],
      body: ['var(--font-size-body)', '1.5'],
      sub: ['var(--font-size-sub)', '1.5'],
      title: ['var(--font-size-title)', '1.5'],
      head: ['var(--font-size-head)', '1.5'],
      large: ['var(--font-size-large)', '1.4'],
    },

    // Z-index scale — use as z-modal, z-tooltip, etc.
    zIndex: {
      base: 'var(--z-base)',
      panel: 'var(--z-panel)',
      sidebar: 'var(--z-sidebar)',
      modal: 'var(--z-modal)',
      gallery: 'var(--z-gallery)',
      tooltip: 'var(--z-tooltip)',
    },
  },

  shortcuts: {
    // ── A photo shown turned (src/photo-turn.ts) ─────────────────────────────
    // The frame has the place and size of the picture; the picture inside fills it, on its side when turned a quarter
    // or three (cqw/cqh: the frame's own width and height), and is rotated about its centre.
    'photo-turn-frame': 'relative overflow-hidden [container-type:size]',
    'photo-turn-picture': 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 block',
    'photo-turn-picture--upright': 'w-[100cqw] h-[100cqh]',
    'photo-turn-picture--sideways': 'w-[100cqh] h-[100cqw]',

    // ── Buttons ──────────────────────────────────────────────────────────────
    // See docs/dev/ui/components.md §2.1 for the canonical button hierarchy.
    'btn-action': [
      'py-5 px-8',
      'bg-[var(--accent-bg)] text-bright',
      'border border-[var(--accent-border)]',
      'rounded-md cursor-pointer',
      'text-body font-medium',
      'transition-colors duration-200',
      '[&:hover:not(:disabled):not([aria-disabled=true])]:bg-[var(--accent-bg-hover)]',
      '[&:hover:not(:disabled):not([aria-disabled=true])]:border-[var(--border-focus)]',
      'disabled:opacity-50 disabled:cursor-default',
      // Greyed out but still pressable (it then says why it is unavailable).
      'aria-disabled:opacity-50 aria-disabled:cursor-default',
    ].join(' '),

    'btn-action--full': 'btn-action w-full',

    'btn-confirm': [
      'py-5 px-8',
      'bg-[var(--btn-confirm-bg)] text-[var(--btn-confirm-text)]',
      'border border-[var(--btn-confirm-border)]',
      'rounded-md cursor-pointer',
      'text-body font-medium',
      'transition-colors duration-200',
      '[&:hover:not(:disabled)]:bg-[var(--btn-confirm-bg-hover)]',
      'disabled:opacity-40 disabled:cursor-not-allowed',
    ].join(' '),

    'btn-cancel': [
      'py-5 px-8',
      'bg-transparent text-dim',
      'border border-[var(--border-panel)]',
      'rounded-md cursor-pointer',
      'text-body',
      'transition-colors duration-200',
      '[&:hover:not(:disabled)]:bg-[var(--btn-cancel-bg-hover)]',
      'disabled:opacity-40',
    ].join(' '),

    'btn-danger': [
      'py-5 px-8',
      'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-text)]',
      'border border-[var(--btn-danger-border)]',
      'rounded-md cursor-pointer',
      'text-body font-medium',
      'transition-colors duration-150',
      '[&:hover:not(:disabled)]:bg-[var(--btn-danger-bg-hover)]',
      '[&:hover:not(:disabled)]:border-[var(--btn-danger-border-hover)]',
      'disabled:opacity-40 disabled:cursor-not-allowed',
    ].join(' '),

    // Icon-only button. Off/rest = ghost (transparent, neutral border, legible
    // icon). Hover = a moderate amber tint (`--accent-fill-lg`) — clearly visible
    // transient feedback, but deliberately LIGHTER than the selected state below
    // so hovering a normal button never looks "more on" than a selected one.
    // Fill scale across states: rest 0% → hover 35% → selected 55% → selected-hover
    // 75%. See docs/dev/ui/components.md §2.1.
    'btn-icon': [
      'bg-transparent border border-[var(--border-white-md)] text-primary',
      'cursor-pointer py-2 px-4 rounded-sm text-body',
      // The content (an SVG, or a text glyph) is centred on both axes in a row at
      // least one line high, so the button keeps the height of a text line.
      'inline-grid grid-rows-[minmax(1lh,auto)] place-items-center place-content-center',
      'transition-colors duration-150',
      'hover:bg-[var(--accent-fill-lg)] hover:border-[var(--border-focus)] hover:text-bright',
      // Disabled: dimmed like the other disabled buttons (.btn-action), no hover fill.
      'disabled:opacity-40 disabled:cursor-default',
      'disabled:hover:bg-transparent disabled:hover:border-[var(--border-white-md)] disabled:hover:text-primary',
    ].join(' '),

    'btn-icon--danger': [
      'btn-icon',
      'text-[var(--color-danger)]',
      'hover:bg-[var(--btn-danger-hover-bg)] hover:border-[var(--btn-danger-hover-border)]',
    ].join(' '),

    // Pressed/on state for an icon toggle button. Off = plain `btn-icon`
    // (never dim with opacity). On = a strong amber fill (`--accent-bg`, 55%) +
    // accent border + bright icon — deliberately MORE prominent than the 35%
    // hover of an off button, so selected always reads as the stronger state.
    // On-hover goes stronger still (`--accent-bg-hover`, 75%). Same active
    // convention used by pagination/language/mirror buttons. See
    // docs/dev/ui/components.md §2.1. Overrides are marked important so the
    // active state always wins over the base `.btn-icon` rule when both classes
    // are applied (`btn-icon btn-icon--active`), regardless of CSS rule order.
    'btn-icon--active': [
      'btn-icon',
      '!bg-[var(--accent-bg)] !border-[var(--border-focus)] !text-bright',
      'hover:!bg-[var(--accent-bg-hover)]',
    ].join(' '),

    // Selected/on state for a destructive icon toggle (e.g. a "Drop" choice):
    // filled red, same footprint as `btn-icon` so toggling doesn't shift layout.
    'btn-icon--danger-active': [
      'btn-icon',
      '!bg-[var(--btn-danger-bg)] !border-[var(--btn-danger-border)] !text-[var(--btn-danger-text)]',
      'hover:!bg-[var(--btn-danger-bg-hover)]',
    ].join(' '),

    // ── Inputs ───────────────────────────────────────────────────────────────
    // Replaces near-identical rules for star-search-input, tag-input,
    // radec-input, targets-coord-input, targets-date-input.
    // A <select> ignores `line-height` (Chromium forces `normal` on a menulist),
    // so it is shorter than an <input> with the same padding. Give it the input's
    // border-box height explicitly: 1.5em (text-body's line-height) + py-2 twice
    // + the 1px border twice (--space-px).
    'input-base': [
      'bg-[var(--bg-input)] text-primary',
      'border border-[var(--border-input)] rounded-sm',
      'px-4 py-2 text-body',
      '[&:is(select)]:h-[calc(1.5em+2*var(--space-2)+2*var(--space-px))]',
      'focus:border-focus focus:outline-none',
      'w-full',
    ].join(' '),

    // ── Observation windows (plan-detail trajectory annotations) ───────────────
    // Draggable shaded time bands over the altitude sparkline, plus their editor
    // rows. Band background/left/width are set inline (dynamic per window); these
    // classes carry only the static frame, cursors, and edge handles.
    'obs-window-layer': 'absolute left-0 right-0 pointer-events-none',
    'obs-window-band': [
      'absolute top-0 bottom-0 rounded-sm overflow-hidden pointer-events-auto',
      'border border-[var(--border-white-md)] cursor-grab',
    ].join(' '),
    'obs-window-handle': [
      'absolute top-0 bottom-0 w-[8px] cursor-ew-resize',
      'bg-[var(--border-focus)] opacity-40 hover:opacity-90 transition-opacity',
    ].join(' '),
    'obs-window-handle-l': 'left-0',
    'obs-window-handle-r': 'right-0',
    // Editor grid: every field is its own column so colours, chips, from, to,
    // duration, frame-count, sub, unit and the icon buttons all line up vertically
    // across rows. Each row is `display:contents`, so its 11 cells flow into these
    // columns in order. Controls are all 26px tall to match the icon buttons.
    'obs-window-rows': [
      'grid items-center gap-x-2 gap-y-1.5 min-w-0',
      // Filter column grows to the longest filter name (min 104px); everything
      // else is content-sized. All columns are shared across rows so fields align.
      'grid-cols-[26px_minmax(104px,max-content)_max-content_max-content_max-content_max-content_max-content_58px_max-content_26px_26px]',
    ].join(' '),
    'obs-window-color': [
      'w-[26px] h-[26px] p-0 cursor-pointer bg-transparent',
      'border border-[var(--border-input)] rounded-sm',
    ].join(' '),
    // Filter picker: fills the shared filter column, chip left-aligned. The column
    // grows to the longest name (see obs-window-rows) so a long custom filter is
    // never clipped; clicking a chip swaps in an input that fills the whole column
    // width. The redundant clear "×" is hidden (click the chip to edit).
    'obs-window-filter': [
      '!flex-none w-full h-[26px] flex items-center justify-start',
      '[&_.integration-filter-clear]:hidden',
      '[&_input]:w-full [&_input]:min-w-0 [&_input]:h-[26px]',
    ].join(' '),
    // Shared time-picker toggle, sized to match the row.
    'obs-window-time-group': [
      'flex items-center gap-1 whitespace-nowrap',
      '[&_.targets-time-input]:h-[26px] [&_.targets-time-input]:px-2 [&_.targets-time-input]:py-0',
      '[&_.targets-time-input]:inline-flex [&_.targets-time-input]:items-center',
    ].join(' '),
    // Single-frame seconds input: fills its column, left-aligned so the digits
    // never collide with the native spinner arrows on the right.
    'obs-window-frame': '!h-[26px] !w-full !text-left !pl-2 !pr-1',
    // Link toggle + trash: square icon buttons at the row height.
    'obs-window-iconbtn': [
      '!h-[26px] !w-[26px] !p-0 inline-flex items-center justify-center',
      '[&_svg]:w-[15px] [&_svg]:h-[15px]',
    ].join(' '),
    // "+ observation window": top-left, level with the first row, row height.
    'obs-window-add': '!h-[26px] !text-micro inline-flex items-center shrink-0',

    // ── Modal sizing variants ───────────────────────────────────────────────────
    // Pairs with the base `.modal` class (src/style.css) the same way the legacy
    // `.settings-modal` / `.import-modal` / … variants do — see
    // docs/dev/ui/components.md §2.2. New variants go here (UnoCSS shortcut),
    // not into style.css, per the CSS decision tree in the UI guidelines hub.
    // `!` is required: virtual:uno.css loads before style.css, so an
    // unmarked utility of equal specificity would lose to `.modal`'s own
    // max-width/max-height (see docs/dev/ui/components.md §2.1 for the same
    // `!` pattern used by `btn-icon--active`).
    'modal-sheet': '!w-[95vw] !max-w-[95vw] !max-h-[90vh] flex flex-col',

    // ── Chips ─────────────────────────────────────────────────────────────────
    'tag-chip': 'inline-flex items-center gap-1 px-2 py-1h rounded-sm text-micro border',
    'tag-chip-sm':
      'inline-flex items-center gap-1 px-3 py-px rounded-xl text-micro border border-[var(--accent-fill-lg)] bg-transparent text-label',

    // ── Gallery photo information panel (MetadataSheet / InlineEditRow) ───────
    // A section: its title line (title + small "+"), then label | value rows.
    'sheet-section': 'flex flex-col gap-1',
    'sheet-section-head': 'flex items-center gap-3 min-h-[22px]',
    'sheet-section-title': 'flex-none text-small font-medium uppercase tracking-[0.06em]',
    // The title line folds and unfolds its section (chevron + title + what it holds while folded).
    'sheet-section-toggle': [
      'w-full min-w-0 min-h-[22px] flex items-center gap-2 p-0 bg-transparent border-0 cursor-pointer text-left',
      'font-[inherit] text-small text-label hover:text-primary',
    ].join(' '),
    // One fact: label | value | its pen (or ✓ ✕ while edited). Hovering the line brightens its pen:
    // the element also needs the plain `group` class (a marker class does nothing inside a shortcut).
    'sheet-row': [
      'relative grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-x-4',
      'min-h-[24px] -mx-2 px-2 rounded-sm hover:bg-[var(--bg-hover)]',
    ].join(' '),
    'sheet-label': 'min-w-0 text-base text-label truncate',
    'sheet-value': 'min-w-0 text-body text-primary truncate',
    'sheet-value--dim': 'text-dim',
    // Small icon buttons of the rows and section titles (pen, calendar, "+", bin).
    'sheet-icon-btn': [
      'inline-flex items-center justify-center flex-none w-[22px] h-[22px] p-0',
      'bg-transparent border border-transparent rounded-md text-muted cursor-pointer',
      'group-hover:text-primary hover:!text-bright hover:bg-[var(--bg-warm-btn)]',
      'disabled:opacity-40 disabled:cursor-default',
      '[&>svg]:w-[12px] [&>svg]:h-[12px]',
    ].join(' '),
    'sheet-icon-btn--on':
      'sheet-icon-btn !bg-[var(--accent-fill-sm)] !border-[var(--accent-fill-lg)] !text-bright',
    // ✓ and ✕ of a row being edited.
    'sheet-ok': 'sheet-icon-btn !border-[var(--border-input)] !text-[var(--status-success-text)]',
    'sheet-cancel': 'sheet-icon-btn !border-[var(--border-input)] !text-dim',
    'sheet-trash': 'sheet-icon-btn !text-[var(--btn-trash-text)]',
    // A small input inside a row.
    'sheet-input': [
      'box-border h-[26px] w-full min-w-0 px-4 rounded-md text-body text-primary font-[inherit]',
      'bg-[var(--bg-input)] border border-[var(--border-input)] outline-none focus:border-[var(--accent-border)]',
    ].join(' '),
    // The pop-ups of the panel (capture fields, more actions, date picker, suggestions).
    'sheet-pop': [
      'absolute z-[5] box-border flex flex-col p-1 rounded-lg',
      'bg-[var(--bg-modal)] border border-[var(--border-input)] shadow-[0_12px_40px_var(--shadow-lg)]',
    ].join(' '),
    'sheet-pop-item': [
      'flex items-center gap-4 h-[28px] px-5 rounded-md text-left whitespace-nowrap text-body font-[inherit]',
      'bg-transparent border-none text-primary cursor-pointer hover:bg-[var(--bg-hover)]',
      'disabled:opacity-40 disabled:cursor-default [&>svg]:w-[12px] [&>svg]:h-[12px]',
    ].join(' '),
    // "Afficher les N objets" / "Réduire" under a folded chip list.
    'sheet-fold': [
      'self-start inline-flex items-center gap-2 h-[22px] mt-1 px-4 rounded-md cursor-pointer font-[inherit]',
      'bg-[var(--bg-warm-btn)] border border-[var(--border-input)] text-secondary text-base',
      'hover:text-primary [&>svg]:w-[12px] [&>svg]:h-[12px]',
    ].join(' '),

    // ── Status banners ────────────────────────────────────────────────────────
    'status-success':
      'bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[var(--status-success-text)]',
    'status-error':
      'bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--status-error-text)]',
    'status-info':
      'bg-[var(--status-info-bg)] border border-[var(--status-info-border)] text-[var(--status-info-text)]',
    'status-warn':
      'bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-[var(--status-warn-text)]',
    // ── Targets outside the search's criteria: their title across the grid, a dimmed card part, a warning chip.
    // (Not `target-…`: UnoCSS reads that prefix as the `:target` variant and generates nothing.)
    'targets-outside-title':
      'col-span-full mt-4 mb-0 text-small font-medium uppercase tracking-[0.06em] text-label',
    'targets-card-dim': 'opacity-55',
    // A target a smart telescope shoots in its mosaic mode: a chip in its own colour beside the constellation's.
    'targets-card-mosaic':
      'shrink-0 text-small leading-[normal] rounded-[var(--radius-sm)] px-[var(--space-3h)] py-[var(--space-1)] border border-solid bg-[var(--target-mosaic-bg)] border-[var(--target-mosaic-border)] text-[var(--target-mosaic-text)]',
    // A night without astronomical darkness: one line under the results toolbar, moon icon then text.
    'targets-darkness-line':
      'col-span-full flex items-center gap-4 px-4 py-2 text-small text-secondary border-b border-b-solid border-[var(--border-panel)]',
    'targets-darkness-icon': 'flex shrink-0 [&>svg]:w-[12px] [&>svg]:h-[12px]',
    'targets-card-warn':
      'shrink-0 text-small leading-[normal] rounded-[var(--radius-sm)] px-[var(--space-3h)] py-[var(--space-1)] status-warn border-solid',

    // ── Import modal: name-collision warning marker ───────────────────────────
    'import-warn-icon': 'shrink-0 cursor-help text-[var(--status-warn-text)]',

    // ── Solver probe results (SolverSettingsModal) ────────────────────────────
    'probe-ok': 'text-[var(--status-success-text)] text-sm',
    'probe-error': 'text-[var(--status-error-text)] text-sm',
    'probe-status-line': 'mt-2 text-sm',
    'probe-summary-ok': 'cursor-pointer text-[var(--status-success-text)] text-sm',

    // ── "Ajouter des photos" (BatchUploadModal and its parts) ────────────────
    // A photo's chips: where its placement stands, where its saving stands.
    'bw-chip':
      'inline-flex items-center gap-1 px-3 rounded-pill text-small border whitespace-nowrap',
    'bw-chip--todo': 'bw-chip status-info',
    'bw-chip--run': 'bw-chip bg-surface border-[var(--border-input)] text-secondary',
    'bw-chip--fail': 'bw-chip status-error',
    'bw-chip--ok': 'bw-chip status-success',
    'bw-chip--warn': 'bw-chip status-warn',
    'bw-chip--saved': 'bw-chip bg-transparent border-[var(--border-input)] text-dim',
    // The list's filters, with their counts.
    'bw-filter': [
      'inline-flex items-baseline gap-2 px-4 py-1h rounded-pill text-base cursor-pointer',
      'bg-transparent border border-[var(--border-input)] text-secondary',
      '[&_b]:font-semibold [&_b]:text-primary',
      'hover:not-disabled:border-[var(--border-focus)]',
      'disabled:opacity-45 disabled:cursor-default',
    ].join(' '),
    'bw-filter--on':
      'bw-filter !bg-[var(--accent-fill-md)] !border-[var(--accent-fill-xl)] !text-bright',
    // A completion bar (Statistics): the fill in an outlined track, so the bar's end and
    // 100 % always show, as on the phone's `.mob-progress-track`. Width comes from the row.
    'progress-track': [
      'block box-border h-[var(--space-5)] p-px rounded-pill overflow-hidden',
      'bg-[var(--bg-deep)] border border-solid border-[var(--border-white-md)]',
    ].join(' '),
    'progress-fill': 'block h-full rounded-pill bg-[var(--accent-fill-xl)]',
    // A row of the photo list: tick box, then the button that shows the photo.
    'bw-row': 'flex items-center gap-5 w-full box-border p-4 border border-transparent rounded-lg',
    'bw-row--sel': 'bw-row bg-[var(--accent-fill-sm)] !border-[var(--accent-fill-lg)]',
    'bw-row--ticked': 'bw-row bg-[var(--bg-hover)]',
    'bw-thumb': [
      'shrink-0 w-[44px] h-[33px] rounded-sm overflow-hidden',
      'bg-[var(--bg-input)] border border-[var(--border-white-xs)]',
      'flex items-center justify-center text-muted [&_svg]:w-4 [&_svg]:h-4',
    ].join(' '),
    // The placement methods, in one box per place they run (this computer, online), each under a heading.
    // (The app's reset sets no border style, so each border below names its style.)
    'bw-method-group':
      'flex flex-col border border-solid border-[var(--border-panel)] rounded-lg bg-card overflow-hidden',
    'bw-method-group-head': [
      'flex items-center gap-3 px-7 py-3 bg-[var(--bg-panel-hdr)]',
      'text-base font-medium text-secondary [&_svg]:w-3.5 [&_svg]:h-3.5',
    ].join(' '),
    // A placement method: title and short line at the left, its action at the right.
    'bw-method': 'flex flex-col gap-3 px-7 py-3 border-t [border-top-style:solid] border-subtle',
    'bw-method--done': 'bw-method bg-[var(--status-success-bg)]',
    // The buttons and solver list of a method row, and the hint's fields: one compact height.
    'bw-method-control': '!h-[var(--space-10)] !py-0 !px-6 !text-base',
    'bw-hint-input': 'input-base !h-[var(--space-10)] !py-0 !text-base',
    // The solve hint, and the mark beside each solve that uses it: the same icon on the same tint.
    'bw-hint': [
      'flex items-center gap-5 px-7 py-3 rounded-lg',
      'border border-solid border-[var(--accent-fill-lg)] bg-[var(--accent-fill-sm)]',
    ].join(' '),
    'bw-hint-mark': [
      'shrink-0 inline-flex items-center justify-center box-border w-[18px] h-[18px] rounded-sm',
      'bg-[var(--accent-fill-sm)] border border-solid border-[var(--accent-fill-lg)] text-[var(--accent-color)]',
      '[&_svg]:w-3 [&_svg]:h-3',
    ].join(' '),
    'bw-hint-mark--lg':
      'bw-hint-mark !w-[var(--space-10)] !h-[var(--space-10)] [&_svg]:!w-3.5 [&_svg]:!h-3.5',
    // A dialog with three choices: its buttons on one line at the right, each as wide as its text.
    'dialog-buttons--row': '!flex justify-end',
    'bw-section-title': 'm-0 text-sub font-medium text-secondary',
    'bw-field-label': 'text-base text-label',
  },
});
