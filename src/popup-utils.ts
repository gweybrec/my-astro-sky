export interface AnchoredPositionOptions {
  /** Align the panel's right edge to the anchor's right edge (default: left-align). */
  alignRight?: boolean;
  /** Gap in px between the anchor and the panel (default 4). */
  gap?: number;
  /** Applied to `panel.style.minWidth` on attach. */
  minWidth?: string;
  /** Called when the anchor has scrolled fully out of the viewport. Fallback path only. */
  onAnchorOutOfView?: () => void;
}

let anchorNameCounter = 0;

/** Whether the browser supports CSS Anchor Positioning (Chromium 125+, not Firefox yet). */
function cssAnchorSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('anchor-name', '--a')
  );
}

/**
 * Pin a `position: fixed` `panel` to `anchorEl`. Prefers native CSS Anchor
 * Positioning (zero-JS, lag-free, the browser keeps the panel glued to the anchor
 * across scroll/resize and flips/hides automatically) and falls back to JS
 * scroll-tracking via {@link trackAnchoredPosition} where unsupported (e.g. Firefox).
 * Returns a cleanup function.
 */
export function attachAnchoredPanel(
  panel: HTMLElement,
  anchorEl: HTMLElement,
  opts: AnchoredPositionOptions = {},
): () => void {
  if (opts.minWidth) panel.style.minWidth = opts.minWidth;

  if (!cssAnchorSupported()) {
    return trackAnchoredPosition(panel, anchorEl, opts);
  }

  const gap = opts.gap ?? 4;
  const name = `--anchored-${++anchorNameCounter}`;
  anchorEl.style.setProperty('anchor-name', name);

  panel.style.position = 'fixed';
  panel.style.setProperty('position-anchor', name);
  // Default placement: directly below the anchor, edge-aligned. position-try
  // fallbacks let the browser flip above / to the other side when there's no room.
  panel.style.top = 'anchor(bottom)';
  panel.style.bottom = 'auto';
  panel.style.marginTop = `${gap}px`;
  panel.style.marginBottom = `${gap}px`;
  if (opts.alignRight) {
    panel.style.left = 'auto';
    panel.style.right = 'anchor(right)';
  } else {
    panel.style.left = 'anchor(left)';
    panel.style.right = 'auto';
  }
  panel.style.setProperty(
    'position-try-fallbacks',
    'flip-block, flip-inline, flip-block flip-inline',
  );
  // Hide the panel when the anchor is scrolled out of view (native equivalent of
  // the fallback's onAnchorOutOfView close).
  panel.style.setProperty('position-visibility', 'anchors-visible');

  return () => {
    anchorEl.style.removeProperty('anchor-name');
  };
}

/**
 * Position a `position: fixed` `panel` against `anchorEl` and keep it tracking the
 * anchor on scroll/resize. Flips above/below depending on available room and clamps
 * horizontally into the viewport. Returns a cleanup function that removes the listeners.
 */
export function trackAnchoredPosition(
  panel: HTMLElement,
  anchorEl: HTMLElement,
  opts: AnchoredPositionOptions = {},
): () => void {
  const gap = opts.gap ?? 4;
  panel.style.position = 'fixed';
  if (opts.minWidth) panel.style.minWidth = opts.minWidth;

  const reposition = (): void => {
    const rect = anchorEl.getBoundingClientRect();
    // Discard once the anchor is scrolled fully out of (or off) the viewport.
    if (
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    ) {
      opts.onAnchorOutOfView?.();
      return;
    }
    const w = panel.offsetWidth || 240;
    const h = panel.offsetHeight || 0;
    // Horizontal: align left or right edge to the anchor, then clamp into the viewport.
    const rawLeft = opts.alignRight ? rect.right - w : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - w - 8));
    // Vertical: below the anchor, or above it when there isn't room below.
    const below = rect.bottom + gap;
    const top =
      below + h <= window.innerHeight - 8 || rect.top < h ? below : Math.max(8, rect.top - gap - h);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  reposition();
  // Capture phase so scrolls inside any nested scroll container are caught too.
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  return () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  };
}

export function positionPopup(popup: HTMLElement, anchorRect: DOMRect): void {
  popup.style.position = 'fixed';
  popup.style.top = '-9999px';
  popup.style.left = '-9999px';
  popup.style.right = '';
  popup.style.bottom = '';
  document.body.appendChild(popup);

  const h = popup.offsetHeight;
  const spaceBelow = window.innerHeight - anchorRect.bottom - 4;
  const spaceAbove = anchorRect.top - 4;
  const goAbove = h > spaceBelow && spaceAbove > spaceBelow;

  popup.style.left = '';
  popup.style.right = `${window.innerWidth - anchorRect.right}px`;

  if (goAbove) {
    popup.style.top = '';
    popup.style.bottom = `${window.innerHeight - anchorRect.top + 4}px`;
  } else {
    popup.style.bottom = '';
    popup.style.top = `${anchorRect.bottom + 4}px`;
  }

  if (popup.getBoundingClientRect().left < 4) {
    popup.style.right = '';
    popup.style.left = '4px';
  }
}
