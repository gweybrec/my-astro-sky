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
  x: number,
  y: number,
  anchorX: number,
  anchorY: number,
  tipLeft: number,
  tipTop: number,
  tipRight: number,
  tipBottom: number,
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

  // Single source of truth for "is a modal open": the presence of any full-screen
  // overlay element in the DOM. Every modal renders one of these backdrop overlays,
  // so detection is automatic and needs no per-modal bookkeeping — this replaces
  // the old register/unregisterModal mechanism that each overlay had to remember to
  // call (and many didn't). Modals also block the map keyboard shortcuts. To make a
  // new modal style block tooltips + shortcuts, give it one of these classes.
  const MODAL_OVERLAY_SELECTOR = '.modal-backdrop, .meta-editor-overlay, .dialog-overlay';
  function isModalOpen(): boolean {
    return (
      typeof document !== 'undefined' && document.querySelector(MODAL_OVERLAY_SELECTOR) !== null
    );
  }

  // Non-modal floating popups that sit over the map (appended to <body> via
  // positionPopup). They have no backdrop, so suppression is position-based: the
  // tooltip is hidden only when the cursor is actually over the popup, so it can
  // never render on top of one — but tooltips keep working over the rest of the
  // open map (e.g. after "add frame" auto-opens the frame manager). Hit-testing the
  // live cursor with elementFromPoint is leak-proof: unlike an enter/leave flag,
  // there is nothing to get stuck if the popup is removed mid-hover.
  const TOOLTIP_POPUP_SELECTOR = '.fov-popup, .photo-gear-popup, .dropdown-panel';
  function cursorOverPopup(clientX: number, clientY: number): boolean {
    if (typeof document === 'undefined') return false;
    return document.elementFromPoint(clientX, clientY)?.closest(TOOLTIP_POPUP_SELECTOR) != null;
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
  // Sky tooltips (star + DSO hover) are suppressed whenever a modal is open (its
  // backdrop covers the whole map), while a small overlay control (FOV ribbon, map
  // export / rotation buttons) requested it via the force flag on hover, or while
  // the cursor is over a floating map popup. The cursor coords come from the canvas
  // hover event; when absent (e.g. interaction disabled) only the modal/force checks
  // apply.
  function isSkyTooltipSuppressed(clientX?: number, clientY?: number): boolean {
    if (_forceSuppressTooltip.value || isModalOpen()) return true;
    if (clientX === undefined || clientY === undefined) return false;
    return cursorOverPopup(clientX, clientY);
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
      tipLeft = r.left;
      tipTop = r.top;
      tipRight = r.right;
      tipBottom = r.bottom;
    }
    return tooltipSafeZoneContains(
      x,
      y,
      ax,
      ay,
      tipLeft,
      tipTop,
      tipRight,
      tipBottom,
      SKY_TOOLTIP_SAFE_MARGIN,
    );
  }

  function showSkyTooltip(html: string, x: number, y: number, dso: DSO | null = null) {
    if (skyTooltipPinned.value) return; // frozen while the plan picker is open
    // Central suppression gate: never render a sky tooltip over an open modal, a
    // force-suppressing overlay control, or a floating popup — whichever caller
    // invoked us. The hover callbacks also pre-check (to skip building the HTML);
    // this is the backstop so any other caller can't draw on top of a modal.
    if (isSkyTooltipSuppressed(x, y)) return;
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
    panelCollapsed,
    currentViewMode,
    setPanelCollapsed,
    switchView,
    pendingBatchFiles,
    pendingUpdate,
    pendingPlanFocusId,
    skyTooltipHtml,
    skyTooltipX,
    skyTooltipY,
    skyTooltipDSO,
    skyTooltipPinned,
    isSkyTooltipSuppressed,
    setSkyTooltip,
    showSkyTooltip,
    requestHideSkyTooltip,
    hideSkyTooltipNow,
    setSkyTooltipPinned,
    setSkyTooltipSelecting,
    setForceSuppressTooltip,
  };
});
