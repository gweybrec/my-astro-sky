/**
 * How a frame reads in the "Contours de champ" list and on its sheet, in the desktop's words (fov-overlay.ts
 * buildFovPopup): a plan frame or a mosaic is named by its target (a mosaic adds "· Mosaïque"), else by the nearest
 * named star; a free frame by its setup and field. The status line is floating or pinned (to its target), the grid
 * of a mosaic and the angle.
 */
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import { customLocationLabelOr, defaultPlanName } from '@myastrosky/core/targets/plan';
import { formatPaDeg } from '@myastrosky/core/frame-orientation';
import { t } from '@myastrosky/core/i18n/index';

export type FrameKind = 'free' | 'plan' | 'freeMosaic' | 'planMosaic';

export function frameKind(f: RenderableFrame): FrameKind {
  if (f.isMosaicOutline) return f.id.split(':')[1] === 'free' ? 'freeMosaic' : 'planMosaic';
  return f.id.startsWith('plan:') ? 'plan' : 'free';
}

/** A frame's name: the free frame's setup label, else its target (or the nearest named star). */
export function frameName(f: RenderableFrame): string {
  const kind = frameKind(f);
  if (kind === 'free') return f.label;
  const base =
    f.anchorLabel ??
    (f.ra != null && f.dec != null
      ? customLocationLabelOr(f.ra, f.dec, t('fovOverlay.customLocation'))
      : t('fovOverlay.customLocation'));
  return f.isMosaicOutline ? `${base} · ${t('targets.plan.mosaicLabel')}` : base;
}

/** The line under the name; `grid` is a mosaic's columns × rows. */
export function frameStatus(f: RenderableFrame, grid?: { cols: number; rows: number }): string {
  const parts: string[] = [];
  if (f.anchorKind === 'screen') parts.push(t('fovOverlay.floating'));
  else if (frameKind(f) === 'free') {
    parts.push(
      f.anchorLabel ? `${t('fovOverlay.pinnedTo')} ${f.anchorLabel}` : t('fovOverlay.pinned'),
    );
  }
  if (f.isMosaicOutline && grid) parts.push(`${grid.cols}×${grid.rows}`);
  if (f.anchorKind === 'sky' && f.paDeg != null) {
    parts.push(`${t('fovOverlay.angleLabel')} ${formatPaDeg(f.paDeg)}`);
  }
  return parts.join(' · ');
}

/** The frame's rotation as the sheet shows it, 0 to 360: its position angle when pinned, its screen angle when floating. */
export function frameRotation(f: RenderableFrame): number {
  const deg = f.anchorKind === 'sky' ? (f.paDeg ?? 0) : (f.screenRotationDeg ?? 0);
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** The name of a plan made from the frames ("Nuit du 18 oct. 2026"), for today's date, as the desktop names it. */
export function newPlanName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return defaultPlanName(today, t);
}

/** One side of a smart telescope frame in degrees, as its Largeur / Hauteur show it: "2.1°", "0.73°" under a degree. */
export function formatFrameSide(deg: number): string {
  return `${deg.toFixed(deg < 1 ? 2 : 1)}°`;
}
