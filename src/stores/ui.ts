import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ViewMode, DSO } from '../types';
import { useCanvasStore } from './canvas';

// Screen offset (px) of the tooltip from the cursor anchor; the tooltip is drawn
// down-right of the anchor. Kept in sync with SkyTooltip.vue's positioning.
export const SKY_TOOLTIP_OFFSET = 15;

// Jitter tolerance (px) for the position-freeze test: small up/left wobble while
// heading toward the tooltip won't make it jump back to the cursor.
export const SKY_TOOLTIP_FOLLOW_TOLERANCE = 3;

// Padding (px) added around the keep-alive safe zone so the tooltip survives small
// overshoots when the cursor is right next to it.
export const SKY_TOOLTIP_SAFE_MARGIN = 16;

// The tooltip stays visible while the cursor is inside the axis-aligned box that
// spans the anchor (where the tooltip first appeared) and the whole tooltip
// rectangle — i.e. the corridor "between the cursor and the tooltip" — padded by
// `margin`. This is purely positional: unlike a velocity test, a jittery frame that
// momentarily points away can't dismiss it.
export function tooltipSafeZoneContains(
  x: number, y: number,
  anchorX: number, anchorY: number,
  tipLeft: number, tipTop: number, tipRight: number, tipBottom: number,
  margin: number,
): boolean {
  const minX = Math.min(anchorX, tipLeft) - margin;
  const minY = Math.min(anchorY, tipTop) - margin;
  const maxX = Math.max(anchorX, tipRight) + margin;
  const maxY = Math.max(anchorY, tipBottom) + margin;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

export const useUiStore = defineStore('ui', () => {
  const canvasStore = useCanvasStore();

  // Single source of truth for "is a modal/popup open": the presence of any
  // full-screen overlay element in the DOM. Every modal/popup renders one of these
  // backdrop overlays, so detection is automatic and needs no per-modal
  // bookkeeping — this replaces the old register/unregisterModal mechanism that
  // each overlay had to remember to call (and many didn't). To make a new overlay
  // style block tooltips, give it one of these classes (or add the class here).
  const MODAL_OVERLAY_SELECTOR = '.modal-backdrop, .meta-editor-overlay, .dialog-overlay';
  function isModalOpen(): boolean {
    return typeof document !== 'undefined'
      && document.querySelector(MODAL_OVERLAY_SELECTOR) !== null;
  }

  const panelCollapsed = ref(false);
  const currentViewMode = ref<ViewMode>('skymap');
  const pendingBatchFiles = ref<File[] | null>(null);

  // Set before switchView('targets') to make the Targets view open the "My plans"
  // tab and expand/scroll to this plan. Consumed (and cleared) on render.
  const pendingPlanFocusId = ref<string | null>(null);

  // Update-available info, set by the startup version check and read by UpdateAvailableModal.
  const pendingUpdate = ref<{ latest: string; url: string } | null>(null);

  // Sky tooltip state — set by canvas hover callbacks in ui.ts
  const skyTooltipHtml = ref<string | null>(null);
  const skyTooltipX = ref(0);
  const skyTooltipY = ref(0);
  // When hovering a DSO in full-info mode, the DSO is exposed here so SkyTooltip.vue
  // can render the interactive action buttons (edit / add-to-plan). Null for star
  // and simplified tooltips, which stay plain text.
  const skyTooltipDSO = ref<DSO | null>(null);
  // While the in-tooltip plan picker (teleported to <body>) is open, the tooltip is
  // pinned so the cursor leaving it for the picker doesn't dismiss it.
  const skyTooltipPinned = ref(false);
  // True while a text-selection drag started inside the tooltip is in progress.
  // Dismissing (removing the node) mid-drag makes the browser reset the selection to
  // the whole page, so we suppress the hide until the mouse button is released.
  const skyTooltipSelecting = ref(false);
  const _forceSuppressTooltip = ref(false);
  // Sky tooltips (star + DSO hover) are suppressed whenever a modal/popup is open,
  // or while a backdrop-less popup (dropdown, gear popup, FOV ribbon) requested it.
  // Read on every canvas hover, so a freshly-opened modal hides the tooltip on the
  // next mouse move without any per-modal registration.
  function isSkyTooltipSuppressed(): boolean {
    return _forceSuppressTooltip.value || isModalOpen();
  }

  // True when the cursor sits in the safe zone between the anchor and the tooltip,
  // so the tooltip should stay open. Uses the live tooltip rect when it's mounted;
  // falls back to the anchor + offset (the near corner) when it isn't (e.g. tests).
  function cursorInSafeZone(x: number, y: number): boolean {
    const ax = skyTooltipX.value;
    const ay = skyTooltipY.value;
    let tipLeft = ax + SKY_TOOLTIP_OFFSET;
    let tipTop = ay + SKY_TOOLTIP_OFFSET;
    let tipRight = tipLeft;
    let tipBottom = tipTop;
    const el = typeof document !== 'undefined' ? document.getElementById('tooltip') : null;
    if (el) {
      const r = el.getBoundingClientRect();
      tipLeft = r.left; tipTop = r.top; tipRight = r.right; tipBottom = r.bottom;
    }
    return tooltipSafeZoneContains(x, y, ax, ay, tipLeft, tipTop, tipRight, tipBottom, SKY_TOOLTIP_SAFE_MARGIN);
  }

  function showSkyTooltip(html: string, x: number, y: number, dso: DSO | null = null) {
    if (skyTooltipPinned.value) return; // frozen while the plan picker is open
    // While hovering the same object, the tooltip would normally follow the cursor
    // (it sits at cursor + offset, down-right). Inside a large object that makes it
    // impossible to reach: it keeps running away. So when the cursor moves *toward*
    // the tooltip (down and/or right, where it's anchored), freeze its position and
    // let the cursor catch up. Only follow when the cursor moves the other way.
    const sameObject = html === skyTooltipHtml.value;
    skyTooltipHtml.value = html;
    skyTooltipDSO.value = dso;
    if (sameObject) {
      const tol = SKY_TOOLTIP_FOLLOW_TOLERANCE;
      const movingToward = x >= skyTooltipX.value - tol && y >= skyTooltipY.value - tol;
      if (!movingToward) {
        skyTooltipX.value = x; // moving away → follow the cursor
        skyTooltipY.value = y;
      }
    } else {
      skyTooltipX.value = x;
      skyTooltipY.value = y;
    }
  }

  // Hide the tooltip — unless the cursor is still inside the safe zone between the
  // anchor and the tooltip, in which case keep it visible so the cursor can reach it.
  // Purely positional (no velocity), so it doesn't flicker away on a jittery frame.
  function requestHideSkyTooltip(x: number, y: number) {
    // Keep open while the plan picker is open or a selection drag is underway.
    if (skyTooltipPinned.value || skyTooltipSelecting.value) return;
    if (skyTooltipHtml.value !== null && !cursorInSafeZone(x, y)) {
      skyTooltipHtml.value = null;
      skyTooltipDSO.value = null;
    }
  }

  // Force-clear the tooltip regardless of direction (e.g. after opening the edit modal).
  function hideSkyTooltipNow() {
    skyTooltipPinned.value = false;
    skyTooltipSelecting.value = false;
    skyTooltipHtml.value = null;
    skyTooltipDSO.value = null;
  }

  function setSkyTooltipPinned(v: boolean) {
    skyTooltipPinned.value = v;
  }

  function setSkyTooltipSelecting(v: boolean) {
    skyTooltipSelecting.value = v;
  }

  // Entry point for the canvas hover callbacks in ui.ts: null requests a directional
  // hide, a non-null html shows/updates the tooltip (with an optional DSO for the
  // interactive action buttons).
  function setSkyTooltip(html: string | null, x: number, y: number, dso: DSO | null = null) {
    if (html === null) {
      requestHideSkyTooltip(x, y);
    } else {
      showSkyTooltip(html, x, y, dso);
    }
  }

  function setForceSuppressTooltip(v: boolean) {
    _forceSuppressTooltip.value = v;
  }

  function setPanelCollapsed(collapsed: boolean) {
    panelCollapsed.value = collapsed;
    document.getElementById('side-panel')?.classList.toggle('collapsed', collapsed);
    const btn = document.getElementById('toggle-panel');
    if (btn) btn.textContent = collapsed ? '◀' : '▶';
    window.dispatchEvent(new CustomEvent('panelToggled', { detail: { collapsed } }));
  }

  function switchView(mode: ViewMode) {
    const prev = currentViewMode.value;
    const sidePanel = document.getElementById('side-panel');

    currentViewMode.value = mode;

    document.getElementById('tab-skymap')?.classList.toggle('active', mode === 'skymap');
    document.getElementById('tab-gallery')?.classList.toggle('active', mode === 'gallery');
    document.getElementById('tab-targets')?.classList.toggle('active', mode === 'targets');

    const mapContainer = document.getElementById('map-container');
    if (mapContainer) mapContainer.style.display = mode === 'skymap' ? 'block' : 'none';

    canvasStore.skyMap?.setInteractionEnabled(mode === 'skymap');

    if (mode === 'gallery') {
      canvasStore.gallery?.show();
      canvasStore.targetsView?.hide();
    } else if (mode === 'targets') {
      canvasStore.gallery?.hide();
      canvasStore.targetsView?.show();
    } else {
      canvasStore.gallery?.hide();
      canvasStore.targetsView?.hide();
    }

    const panelVisible = mode === 'skymap';
    if (sidePanel) sidePanel.style.display = panelVisible ? '' : 'none';
    const toggleBtn = document.getElementById('toggle-panel');
    if (toggleBtn) toggleBtn.style.display = panelVisible ? '' : 'none';

    window.dispatchEvent(new CustomEvent('viewModeChanged', { detail: { mode } }));
  }

  return {
    isModalOpen,
    panelCollapsed, currentViewMode, setPanelCollapsed, switchView,
    pendingBatchFiles, pendingUpdate, pendingPlanFocusId,
    skyTooltipHtml, skyTooltipX, skyTooltipY, skyTooltipDSO, skyTooltipPinned,
    isSkyTooltipSuppressed, setSkyTooltip, showSkyTooltip, requestHideSkyTooltip,
    hideSkyTooltipNow, setSkyTooltipPinned, setSkyTooltipSelecting, setForceSuppressTooltip,
  };
});
