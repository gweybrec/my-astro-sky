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
    // ── Buttons ──────────────────────────────────────────────────────────────
    // See docs/dev/ui/components.md §2.1 for the canonical button hierarchy.
    'btn-action': [
      'py-5 px-8',
      'bg-[var(--accent-bg)] text-bright',
      'border border-[var(--accent-border)]',
      'rounded-md cursor-pointer',
      'text-body font-medium',
      'transition-colors duration-200',
      '[&:hover:not(:disabled)]:bg-[var(--accent-bg-hover)]',
      '[&:hover:not(:disabled)]:border-[var(--border-focus)]',
      'disabled:opacity-50 disabled:cursor-default',
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
      'py-4 px-8',
      'bg-transparent text-dim',
      'border border-[var(--border-panel)]',
      'rounded-md cursor-pointer',
      'text-body',
      'transition-colors duration-200',
      '[&:hover:not(:disabled)]:bg-[var(--btn-cancel-bg-hover)]',
      'disabled:opacity-40',
    ].join(' '),

    'btn-danger': [
      'py-4 px-8',
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
      'transition-colors duration-150',
      'hover:bg-[var(--accent-fill-lg)] hover:border-[var(--border-focus)] hover:text-bright',
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
    'input-base': [
      'bg-[var(--bg-input)] text-primary',
      'border border-[var(--border-input)] rounded-sm',
      'px-4 py-2 text-body',
      'focus:border-focus focus:outline-none',
      'w-full',
    ].join(' '),

    // ── Chips ─────────────────────────────────────────────────────────────────
    'tag-chip': 'inline-flex items-center gap-1 px-2 py-1h rounded-sm text-micro border',
    'tag-chip-sm':
      'inline-flex items-center gap-1 px-3 py-px rounded-xl text-micro border border-[var(--accent-fill-lg)] bg-transparent text-label',

    // ── Status banners ────────────────────────────────────────────────────────
    'status-success':
      'bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[var(--status-success-text)]',
    'status-error':
      'bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--status-error-text)]',
    'status-info':
      'bg-[var(--status-info-bg)] border border-[var(--status-info-border)] text-[var(--status-info-text)]',
    'status-warn':
      'bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-[var(--status-warn-text)]',

    // ── Import modal: name-collision warning marker ───────────────────────────
    'import-warn-icon': 'shrink-0 cursor-help text-[var(--status-warn-text)]',

    // ── Solver probe results (SolverSettingsModal) ────────────────────────────
    'probe-ok': 'text-[var(--status-success-text)] text-sm',
    'probe-error': 'text-[var(--status-error-text)] text-sm',
    'probe-status-line': 'mt-2 text-sm',
    'probe-summary-ok': 'cursor-pointer text-[var(--status-success-text)] text-sm',
  },
});
