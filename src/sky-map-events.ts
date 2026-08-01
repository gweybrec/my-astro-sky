/**
 * Pointer and keyboard wiring for the sky map, extracted from `sky-map.ts`.
 *
 * These handlers are pure *routing*: each gesture is dispatched to whichever
 * subsystem claims it, in a fixed precedence order, and nothing here draws or
 * computes sky geometry beyond the pan anchor. That routing is what this module
 * makes testable — a stub {@link SkyEventHost} plus synthetic DOM events is enough
 * to assert every precedence rule without a canvas.
 *
 * Precedence, highest first:
 *
 * - **mousedown** — region drawing → frame interaction → pan.
 * - **mousemove** — region drawing → frame drag → pan → hover.
 * - **mouseup**   — region drawing → frame drag → pan (which then decides whether
 *   the gesture was a click, and routes it to star-pick / photo / DSO).
 * - **Escape**    — region drawing → picking mode → deselect the active frame.
 *
 * The pan state lives here because only these handlers touch it.
 */
import type { Star, ViewState } from './types';
import type { PhotoOutline } from './photo-outline';
import type { AltAzPoint } from './sky-map-types';
import { fromCanvas, isInsideBorderCircle } from './projection';
import { zoomAboutPoint } from './sky-view-math';
import { findTopPhotoOutlineAtPoint } from './photo-outline';

/** One registered listener, so the caller can remove them all on destroy. */
export interface EventBinding {
  target: EventTarget;
  event: string;
  handler: EventListener;
}

/** Everything the handlers need from the sky map. */
export interface SkyEventHost {
  readonly canvas: HTMLCanvasElement;
  /** Mutated in place by the pan and wheel handlers. */
  readonly view: ViewState;
  readonly borderLatDeg: number;
  readonly interactionEnabled: boolean;
  readonly pickingMode: boolean;
  readonly photoOutlines: PhotoOutline[];
  /** The DSO currently under the cursor (set by the hover pass), or null. */
  readonly hoveredDSO: { id: string } | null;
  /** True while a DSO or star is selected — gates the context-menu suppression. */
  hasSelection(): boolean;

  // Region drawing
  regionDrawActive(): boolean;
  regionDrawCapturing(): boolean;
  regionDrawPress(): void;
  regionDrawMove(pt: AltAzPoint | null): void;
  regionDrawFinish(cancelled: boolean): void;
  canvasToAltAz(mx: number, my: number): AltAzPoint | null;

  // Frames
  frameMouseDown(mx: number, my: number): boolean;
  frameDragActive(): boolean;
  frameDragMove(mx: number, my: number): void;
  frameMouseUp(): void;
  frameHasActive(): boolean;
  frameClearInteraction(): void;
  frameSelect(id: string | null): void;

  // Map actions
  cancelAnimation(): void;
  dismissTooltip(): void;
  requestHover(mx: number, my: number, clientX: number, clientY: number): void;
  requestRenderInteractive(): void;
  render(): void;
  viewChanged(): void;
  findClosestStar(mx: number, my: number): Star | null;
  exitPickingMode(): void;

  // Click callbacks. The `has*` predicates gate the (non-trivial) hit-tests, so a
  // click costs nothing when no consumer is listening — as it did inline.
  hasStarPickedHandler(): boolean;
  hasPhotoClickHandler(): boolean;
  emitStarPicked(star: Star): void;
  emitPhotoClick(photoName: string): void;
  emitDSOClick(): void;
  emitClearSelection(): void;
}

/** A click (rather than a drag) is a release within this many px of the press. */
export const CLICK_SLOP_PX = 3;

/**
 * Attach every sky-map pointer/keyboard handler and return the bindings so the
 * caller can remove them in `destroy()`.
 */
export function attachSkyMapEvents(host: SkyEventHost): EventBinding[] {
  const bindings: EventBinding[] = [];
  const add = (
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(event, handler, options);
    bindings.push({ target, event, handler });
  };

  // Pan state — only these handlers touch it.
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panAnchorProjX = 0;
  let panAnchorProjY = 0;

  /** Cursor position relative to the canvas. */
  const local = (e: MouseEvent) => {
    const rect = host.canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  };

  // ── Zoom with the mouse wheel ─────────────────────────────────────────────
  add(
    host.canvas,
    'wheel',
    ((e: WheelEvent) => {
      e.preventDefault();
      host.cancelAnimation();
      // A wheel gesture takes over from hovering: hide any tooltip so it doesn't
      // linger over the moving map while the user zooms.
      host.dismissTooltip();
      const { mx, my } = local(e);

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      // Keep the projection point under the cursor anchored across the zoom.
      const z = zoomAboutPoint(host.view, mx, my, factor, 50, 1000000);
      host.view.scale = z.scale;
      host.view.centerX = z.centerX;
      host.view.centerY = z.centerY;

      host.viewChanged();
      host.requestRenderInteractive();
    }) as EventListener,
    { passive: false },
  );

  // ── Press: region draw → frame → pan ──────────────────────────────────────
  add(host.canvas, 'mousedown', ((e: MouseEvent) => {
    host.cancelAnimation();
    if (e.button !== 0) return;

    if (host.regionDrawActive()) {
      host.regionDrawPress();
      const { mx, my } = local(e);
      host.regionDrawMove(host.canvasToAltAz(mx, my));
      host.requestRenderInteractive();
      return; // region drawing consumed the press — no pan
    }

    const f = local(e);
    if (host.frameMouseDown(f.mx, f.my)) {
      // A frame grab can start right over a DSO/star (e.g. the centre move
      // dot sits on the DSO inside the frame), so hide any hover tooltip.
      host.dismissTooltip();
      return; // frame interaction consumed the press — no pan
    }

    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    const { mx, my } = local(e);
    const anchor = fromCanvas(mx, my, host.view);
    panAnchorProjX = anchor.x;
    panAnchorProjY = anchor.y;
    if (!host.pickingMode) {
      host.canvas.style.cursor = 'grabbing';
    }
  }) as EventListener);

  // Right-click clears the active DSO/star selection (and suppresses the
  // browser context menu when there was something to clear).
  add(host.canvas, 'contextmenu', ((e: MouseEvent) => {
    if (!host.hasSelection()) return;
    e.preventDefault();
    host.emitClearSelection();
  }) as EventListener);

  // ── Move: region draw → frame drag → pan → hover ──────────────────────────
  add(window, 'mousemove', ((e: MouseEvent) => {
    if (host.regionDrawActive()) {
      // Suppress hover/tooltips for the whole gesture (not just while dragging) —
      // a star/DSO tooltip popping up under the crosshair gets in the way of drawing.
      host.dismissTooltip();
      if (host.regionDrawCapturing()) {
        const { mx, my } = local(e);
        host.regionDrawMove(host.canvasToAltAz(mx, my));
        host.requestRenderInteractive();
      }
      return;
    }

    if (host.frameDragActive()) {
      const { mx, my } = local(e);
      host.frameDragMove(mx, my);
      return;
    }

    if (isPanning) {
      const { mx, my } = local(e);
      const now = fromCanvas(mx, my, host.view);
      host.view.centerX += panAnchorProjX - now.x;
      host.view.centerY += panAnchorProjY - now.y;
      host.viewChanged();
      host.requestRenderInteractive();
      return;
    }

    if (!host.interactionEnabled) return;
    // Cursor is over the (now-interactive) tooltip: leave it as-is so the
    // user can move into it to select/copy without it hiding.
    if ((e.target as HTMLElement)?.closest?.('#tooltip')) return;

    const { mx, my } = local(e);

    // Check if mouse is over the side panel by checking if it's on the right side
    const sidePanel = document.getElementById('side-panel');
    const isOverPanel =
      sidePanel &&
      !sidePanel.classList.contains('collapsed') &&
      e.clientX > window.innerWidth - 280; // Panel is 280px wide on the right

    const inSky = !isOverPanel && isInsideBorderCircle(mx, my, host.view, host.borderLatDeg);
    if (inSky) {
      host.requestHover(mx, my, e.clientX, e.clientY);
    } else {
      // Cursor is over the side panel or outside the visible sky circle (in the
      // black corners beyond the rim). Dismiss any tooltip so it never lingers or
      // fires out there — the render loop clips objects to this same circle, so a
      // rectangular hover gate would tooltip objects the user cannot see.
      host.dismissTooltip();
    }
  }) as EventListener);

  // ── Release: region draw → frame drag → pan (then click routing) ──────────
  add(window, 'mouseup', ((e: MouseEvent) => {
    if (host.regionDrawActive()) {
      host.regionDrawFinish(!host.regionDrawCapturing());
      return;
    }
    if (host.frameDragActive()) {
      host.frameMouseUp();
      return;
    }
    if (!isPanning) return;

    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    const moved = Math.abs(dx) + Math.abs(dy) > CLICK_SLOP_PX;

    isPanning = false;
    host.canvas.style.cursor = host.pickingMode ? 'crosshair' : 'default';

    if (moved) return; // a drag, not a click — no selection action

    const { mx, my } = local(e);

    // Picking mode: click (not drag) selects star
    if (host.pickingMode) {
      if (host.hasStarPickedHandler()) {
        const star = host.findClosestStar(mx, my);
        if (star) host.emitStarPicked(star);
      }
      return; // picking mode swallows the photo/DSO click paths
    }

    // Photo click: test if click lands inside a photo outline
    if (host.hasPhotoClickHandler()) {
      const photoName = findTopPhotoOutlineAtPoint(mx, my, host.photoOutlines);
      if (photoName) host.emitPhotoClick(photoName);
    }

    // DSO click: fires alongside the photo click if a DSO is under the cursor.
    if (host.hoveredDSO) host.emitDSOClick();
  }) as EventListener);

  // ── Escape: region draw → picking mode → deselect the active frame ────────
  add(window, 'keydown', ((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (host.regionDrawActive()) {
      host.regionDrawFinish(true);
    } else if (host.pickingMode) {
      host.exitPickingMode();
    } else if (host.frameHasActive()) {
      // Abandon any in-progress snap drag/animation so deselecting can't leave
      // a dangling elastic overlay or running rAF.
      host.frameClearInteraction();
      host.frameSelect(null);
      host.render();
    }
  }) as EventListener);

  return bindings;
}
