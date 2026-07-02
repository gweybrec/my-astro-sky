/**
 * Pure DSO label logic, extracted from `sky-map.ts`'s `renderDSOLabels` so the text
 * formatting and visibility gates can be unit-tested. The renderer keeps only the
 * culling loop + `ctx.fillText`.
 */
import type { DSO, ViewState } from './types';

/** Messier objects are `M<n>` (not `M0…`, which are other catalogs' ids). */
export function isMessier(id: string): boolean {
  return id.startsWith('M') && !id.startsWith('M0');
}

/**
 * Human-readable label for a DSO id: Messier shown as-is, LPN objects use their proper
 * name, and other catalogs get a space inserted after the prefix (NGC/IC/LBN/LDN/Sh2/
 * vdB/Abell/Barnard). Mirrors the original inline `replace` chain exactly.
 */
export function formatDsoLabel(dso: DSO): string {
  const id = dso.id;
  if (isMessier(id)) return id;
  if (id.startsWith('LPN-')) return dso.displayName || id.replace(/^LPN-/, '');
  return id
    .replace('NGC', 'NGC ')
    .replace(/^IC(\d)/, 'IC $1')
    .replace('LBN', 'LBN ')
    .replace('LDN', 'LDN ')
    .replace('SH2-', 'Sh2-')
    .replace('vdB', 'vdB ')
    .replace(/^(Abell)(\d)/, '$1 $2')
    .replace(/^(Barnard)(\d)/, '$1 $2');
}

/**
 * Whether a DSO's label should be drawn at the current zoom. Messier objects appear
 * once zoomed past scale 100; everything else needs a closer zoom (scale > 300) and a
 * rendered radius over 4px. Matches the original gates.
 */
export function dsoLabelVisible(dso: DSO, rxPx: number, view: Pick<ViewState, 'scale'>): boolean {
  const mess = isMessier(dso.id);
  if (mess && view.scale <= 100) return false;
  if (!mess && (view.scale <= 300 || rxPx <= 4)) return false;
  return true;
}
