/**
 * Generic key-value and text tooltip utilities shared across modules.
 * Renders using `.hints-info-tooltip` / `.dso-info-table` CSS classes.
 */

let _tipAnchor: HTMLElement | null = null;

function _buildTooltip(anchor: HTMLElement, populate: (tip: HTMLDivElement) => void): void {
  const existing = document.querySelector('.hints-info-tooltip');

  // If our tracked anchor lost its tooltip externally, reset before toggle check
  if (_tipAnchor !== null && !existing) _tipAnchor = null;

  existing?.remove();

  if (_tipAnchor === anchor) {
    _tipAnchor = null;
    return; // toggle off
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'hints-info-tooltip';

  populate(tooltip);

  _tipAnchor = anchor;
  document.body.appendChild(tooltip);

  const aRect = anchor.getBoundingClientRect();
  const tRect = tooltip.getBoundingClientRect();
  let left = aRect.right + 10;
  if (left + tRect.width > window.innerWidth - 20) left = aRect.left - tRect.width - 10;
  let top = aRect.top;
  if (top + tRect.height > window.innerHeight - 20) top = window.innerHeight - tRect.height - 20;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  const closeOutside = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      tooltip.remove();
      _tipAnchor = null;
      document.removeEventListener('mousedown', closeOutside);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeOutside), 0);
}

/** Show a positioned key-value table tooltip near `anchor`. */
export function showKeyValueTooltip(
  anchor: HTMLElement,
  rows: [string, string | null | undefined][],
): void {
  _buildTooltip(anchor, tip => {
    const table = document.createElement('table');
    table.className = 'dso-info-table';
    for (const [key, val] of rows) {
      if (val == null) continue;
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = key;
      const td2 = document.createElement('td');
      td2.textContent = val;
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    }
    tip.appendChild(table);
  });
}

/**
 * Show a tooltip near `anchor` with custom content built by `populate`,
 * reusing the shared toggle / positioning / close-on-outside-click logic.
 */
export function showCustomTooltip(anchor: HTMLElement, populate: (tip: HTMLDivElement) => void): void {
  _buildTooltip(anchor, populate);
}

/** Show a plain-text description tooltip near `anchor`. */
export function showTextTooltip(anchor: HTMLElement, text: string): void {
  _buildTooltip(anchor, tip => {
    const p = document.createElement('p');
    p.className = 'tooltip-text';
    p.textContent = text;
    tip.appendChild(p);
  });
}
