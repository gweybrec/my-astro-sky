import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useUiStore,
  SKY_TOOLTIP_FOLLOW_TOLERANCE,
  SKY_TOOLTIP_SAFE_MARGIN,
  tooltipSafeZoneContains,
} from '../../src/stores/ui';
import type { DSO } from '../../src/types';

const fakeDSO = (id: string) => ({ id, catalogs: [id] }) as unknown as DSO;

describe('tooltipSafeZoneContains', () => {
  // Anchor at (100,100), a tall/wide tooltip rect, margin 16.
  const ax = 100,
    ay = 100;
  const left = 115,
    top = 115,
    right = 215,
    bottom = 315;
  const m = SKY_TOOLTIP_SAFE_MARGIN;
  const inZone = (x: number, y: number) =>
    tooltipSafeZoneContains(x, y, ax, ay, left, top, right, bottom, m);

  it('keeps the whole tooltip body inside the zone (even the lower edge)', () => {
    expect(inZone(115, 250)).toBe(true); // left edge, low down a tall tooltip
    expect(inZone(215, 315)).toBe(true); // far corner
  });

  it('keeps the corridor between anchor and tooltip', () => {
    expect(inZone(108, 108)).toBe(true);
    expect(inZone(100, 100)).toBe(true);
  });

  it('rejects points outside the padded box', () => {
    expect(inZone(60, 60)).toBe(false); // past the anchor
    expect(inZone(250, 250)).toBe(false); // right of the tooltip
    expect(inZone(150, 340)).toBe(false); // below the tooltip
  });

  it('honours the margin', () => {
    expect(inZone(100 - m, 100)).toBe(true); // exactly on the padded edge
    expect(inZone(100 - m - 1, 100)).toBe(false); // just past it
  });
});

describe('ui store — sky tooltip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('showSkyTooltip sets html/position immediately', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('<b>M42</b>', 100, 200);
    expect(ui.skyTooltipHtml).toBe('<b>M42</b>');
    expect(ui.skyTooltipX).toBe(100);
    expect(ui.skyTooltipY).toBe(200);
  });

  it('showSkyTooltip refuses to render while a modal is open (central suppression backstop)', () => {
    const ui = useUiStore();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    // Even a caller that does not pre-check isSkyTooltipSuppressed must not draw over a modal.
    ui.showSkyTooltip('<b>M42</b>', 100, 200);
    expect(ui.skyTooltipHtml).toBeNull();
    backdrop.remove();
  });

  it('showSkyTooltip refuses to render while the force-suppress flag is set', () => {
    const ui = useUiStore();
    ui.setForceSuppressTooltip(true);
    ui.showSkyTooltip('<b>M42</b>', 100, 200);
    expect(ui.skyTooltipHtml).toBeNull();
    ui.setForceSuppressTooltip(false);
  });

  // ─── Position freeze while approaching the tooltip (same object) ───────────────

  it('freezes position when the cursor moves toward the tooltip on the same object', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.showSkyTooltip('M42', 130, 140); // down-right toward the offset tooltip → frozen
    expect(ui.skyTooltipX).toBe(100);
    expect(ui.skyTooltipY).toBe(100);
  });

  it('follows the cursor when it moves away (up/left) on the same object', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.showSkyTooltip('M42', 80, 70); // up-left = away → follow
    expect(ui.skyTooltipX).toBe(80);
    expect(ui.skyTooltipY).toBe(70);
  });

  it('tolerates small jitter while heading toward the tooltip', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.showSkyTooltip(
      'M42',
      100 - SKY_TOOLTIP_FOLLOW_TOLERANCE,
      100 - SKY_TOOLTIP_FOLLOW_TOLERANCE,
    );
    expect(ui.skyTooltipX).toBe(100);
    expect(ui.skyTooltipY).toBe(100);
  });

  it('always repositions when switching to a different object', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.showSkyTooltip('M31', 130, 140);
    expect(ui.skyTooltipX).toBe(130);
    expect(ui.skyTooltipY).toBe(140);
  });

  // ─── Safe-zone hide (positional, no velocity) ─────────────────────────────────
  // With no #tooltip element mounted, the zone falls back to the box from the anchor
  // (100,100) to the near corner (115,115), padded by SKY_TOOLTIP_SAFE_MARGIN (16):
  // x,y ∈ [84, 131].

  it('keeps the tooltip while the cursor is in the corridor toward it', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.requestHideSkyTooltip(108, 108); // between anchor and tooltip → keep
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('keeps the tooltip on a small backward jitter while still close to it', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.requestHideSkyTooltip(112, 112); // toward
    ui.requestHideSkyTooltip(106, 106); // technically away, but still inside the zone
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('hides only once the cursor leaves the zone (well up-left)', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.requestHideSkyTooltip(60, 60); // past the anchor, outside the zone
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('hides when the cursor moves above the zone', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.requestHideSkyTooltip(100, 60); // y below minY (84) → outside
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('does not dismiss when the cursor has not moved', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100);
    ui.requestHideSkyTooltip(100, 100);
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('requestHideSkyTooltip is a no-op when no tooltip is shown', () => {
    const ui = useUiStore();
    ui.requestHideSkyTooltip(50, 50);
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('setSkyTooltip shim: html shows, null routes to a safe-zone hide', () => {
    const ui = useUiStore();
    ui.setSkyTooltip('M42', 100, 100);
    expect(ui.skyTooltipHtml).toBe('M42');
    ui.setSkyTooltip(null, 60, 60); // outside the zone → hide
    expect(ui.skyTooltipHtml).toBeNull();
  });

  // ─── DSO payload for the interactive action buttons ────────────────────────────

  it('carries the DSO when provided and clears it otherwise', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    expect(ui.skyTooltipDSO?.id).toBe('M42');
    ui.showSkyTooltip('HIP 1', 200, 200); // star tooltip, no DSO
    expect(ui.skyTooltipDSO).toBeNull();
  });

  it('clears the DSO when the tooltip is hidden', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.requestHideSkyTooltip(80, 80); // away → hide
    expect(ui.skyTooltipHtml).toBeNull();
    expect(ui.skyTooltipDSO).toBeNull();
  });

  // ─── Pinning while the plan picker is open ─────────────────────────────────────

  it('does not hide while pinned, even when moving away', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.setSkyTooltipPinned(true);
    ui.requestHideSkyTooltip(0, 0); // strongly away
    expect(ui.skyTooltipHtml).toBe('M42');
    expect(ui.skyTooltipDSO?.id).toBe('M42');
  });

  it('does not change content while pinned (hover behind the picker is ignored)', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.setSkyTooltipPinned(true);
    ui.showSkyTooltip('M31', 300, 300, fakeDSO('M31'));
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('hideSkyTooltipNow force-clears and unpins', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.setSkyTooltipPinned(true);
    ui.hideSkyTooltipNow();
    expect(ui.skyTooltipHtml).toBeNull();
    expect(ui.skyTooltipDSO).toBeNull();
    expect(ui.skyTooltipPinned).toBe(false);
  });

  // ─── Selection-drag guard (prevents the select-all-on-dismiss bug) ─────────────

  it('does not hide while a selection drag is in progress, even outside the zone', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.setSkyTooltipSelecting(true);
    ui.requestHideSkyTooltip(0, 0); // dragged far outside the tooltip
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('hides again once the selection drag ends', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 100, 100, fakeDSO('M42'));
    ui.setSkyTooltipSelecting(true);
    ui.requestHideSkyTooltip(0, 0);
    expect(ui.skyTooltipHtml).toBe('M42');
    ui.setSkyTooltipSelecting(false); // mouseup
    ui.requestHideSkyTooltip(0, 0);
    expect(ui.skyTooltipHtml).toBeNull();
  });
});

describe('ui store — modal detection & tooltip suppression', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
  });

  it('reports no open modal and no suppression by default', () => {
    const ui = useUiStore();
    expect(ui.isModalOpen()).toBe(false);
    expect(ui.isSkyTooltipSuppressed()).toBe(false);
  });

  // Detection is DOM-based: any overlay class counts, with no per-modal
  // registration. Covers BaseModal/standalone modals (.modal-backdrop), the
  // gallery metadata editor (.meta-editor-overlay) and confirm dialogs
  // (.dialog-overlay).
  it.each(['modal-backdrop', 'meta-editor-overlay', 'dialog-overlay'])(
    'detects an open modal from a .%s overlay in the DOM',
    (cls) => {
      const ui = useUiStore();
      const el = document.createElement('div');
      el.className = cls;
      document.body.appendChild(el);
      expect(ui.isModalOpen()).toBe(true);
      expect(ui.isSkyTooltipSuppressed()).toBe(true);

      el.remove();
      expect(ui.isModalOpen()).toBe(false);
      expect(ui.isSkyTooltipSuppressed()).toBe(false);
    },
  );

  // Non-modal floating map popups (FOV frames, photo gear) suppress tooltips only
  // while the cursor is over them (position-based, via elementFromPoint), so
  // tooltips keep working over the rest of the map. They are NOT modals.
  it.each(['fov-popup', 'photo-gear-popup'])(
    'suppresses tooltips only while the cursor is over a .%s popup',
    (cls) => {
      const ui = useUiStore();
      const popup = document.createElement('div');
      popup.className = cls;
      const inner = document.createElement('button');
      popup.appendChild(inner);
      document.body.appendChild(popup);

      // Cursor over the popup → suppressed; over the open map → not.
      const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(inner);
      expect(ui.isModalOpen()).toBe(false);
      expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(true);

      spy.mockReturnValue(document.body);
      expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(false);
      spy.mockRestore();
    },
  );

  it('does not suppress map tooltips while a popup is open but the cursor is elsewhere', () => {
    const ui = useUiStore();
    const popup = document.createElement('div');
    popup.className = 'fov-popup';
    document.body.appendChild(popup);
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body);
    // Regression: auto-opening the FOV popup (e.g. after "add frame") must not kill
    // tooltips across the whole map.
    expect(ui.isSkyTooltipSuppressed(500, 500)).toBe(false);
    spy.mockRestore();
  });

  it('suppresses tooltips for a backdrop-less control via the force flag', () => {
    const ui = useUiStore();
    ui.setForceSuppressTooltip(true);
    expect(ui.isModalOpen()).toBe(false); // no DOM overlay
    expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(true);

    ui.setForceSuppressTooltip(false);
    expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(false);
  });
});

describe('ui store — targets overlay', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Regression: closing the overlay re-renders the Plans view, which rebuilds
  // every plan's <details> collapsed unless pendingPlanFocusId names it.
  it('opening the overlay from a specific plan marks that plan to stay expanded', () => {
    const ui = useUiStore();
    ui.openTargetsOverlay('plan-1');
    expect(ui.targetsOverlayPlanId).toBe('plan-1');
    expect(ui.pendingPlanFocusId).toBe('plan-1');
  });

  it('opening the overlay generically (no plan) leaves pendingPlanFocusId untouched', () => {
    const ui = useUiStore();
    ui.pendingPlanFocusId = 'plan-2'; // set by some earlier, unrelated action
    ui.openTargetsOverlay();
    expect(ui.targetsOverlayPlanId).toBeNull();
    expect(ui.pendingPlanFocusId).toBe('plan-2');
  });
});
