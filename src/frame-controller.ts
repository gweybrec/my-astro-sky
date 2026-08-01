/**
 * Interactive FOV-frame state machine, extracted from `sky-map.ts`.
 *
 * Owns every frame instance and the whole in-flight interaction state: which frame is
 * being dragged and in what mode, the rubber-band resize draft, the pending DSO snap
 * target, and the snap-back animation handle. It also owns the callbacks that report
 * changes back to the frame store.
 *
 * All canvas geometry is delegated to `./frame-geometry` (pure) and the drag decisions
 * to `./fov-frame-geometry` / `./frame-interaction` (also pure); this module is the
 * stateful glue that was previously untestable because it lived inside the canvas class.
 *
 * Everything it needs from the map arrives through {@link FrameHost}, so the whole
 * controller can be driven in a unit test with a plain `ViewState` and no canvas.
 */
import type { DSO, Point, ViewState } from './types';
import type { RenderableFrame, FovFrameChange, FovFrameResizeRegion } from './sky-map-types';
import { normalizeRotationDeg } from './sky-map-types';
import { fromCanvas, project, toCanvas, unproject, getHemisphere } from './projection';
import { normalizeRA } from './star-catalog';
import { clampSmartMosaicSize } from './mosaic';
import { frameTargetDso } from './fov-frame-target';
import {
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
  resizeFromCorner,
} from './fov-frame-geometry';
import {
  frameAnchorCanvas,
  canvasRotDegToPa,
  frameCanvasRotationDeg,
  frameGeometry,
  mosaicOutlinePath,
  frameHandlesVisible,
  framePinGlyphPos,
  type FrameGeometry,
} from './frame-geometry';
import { findMergeTarget, resizeRegionFromDraft, type ResizeDraft } from './frame-interaction';
import { computeFovTargetScale } from './gear-presets';
import { pointInConvexPolygon } from './photo-outline';
import { TILE_TRASH_R } from './sky-draw';

/** What the controller needs from the sky map. */
export interface FrameHost {
  /** The live view — read on every geometry computation, never cached. */
  readonly view: ViewState;
  /** Whether map interaction is enabled at all (another view may be active). */
  readonly interactionEnabled: boolean;
  /** Star-picking mode swallows frame interaction. */
  readonly pickingMode: boolean;
  findClosestDSO(mx: number, my: number): DSO | null;
  dsosInFrame(f: RenderableFrame): DSO[];
  requestRenderInteractive(): void;
  render(): void;
  navigateTo(ra: number, dec: number, targetScale: number, animate: boolean): void;
}

/** An in-progress drag on the active frame. */
export interface FrameDrag {
  id: string;
  mode: 'move' | 'rotate' | 'resize';
  corner?: number;
}

/** The DSO a move-drag will snap to on release; drives the elastic overlay. */
export interface SnapCandidate {
  id: string;
  ra: number;
  dec: number;
  majAxis: number;
}

export class FrameController {
  private host: FrameHost;

  /** Interactive frame instances (independent anchor + rotation, single active). */
  private instances: RenderableFrame[] = [];
  private drag: FrameDrag | null = null;
  /** Transient rubber-band rectangle shown while a resize drag is in progress. */
  private draft: ResizeDraft | null = null;
  private snap: SnapCandidate | null = null;
  /** In-flight snap-back animation after a release within range. */
  private snapAnim: { id: string; raf: number } | null = null;
  /** Add-tile: sky positions of the "+" spots around the selected mosaic. */
  private addCandidates: Array<{ ra: number; dec: number }> = [];

  private onSelect: ((id: string | null) => void) | null = null;
  private onChange: ((id: string, change: FovFrameChange) => void) | null = null;
  private onResize: ((id: string, region: FovFrameResizeRegion) => void) | null = null;
  private onTileRemove: ((tileId: string) => void) | null = null;
  private onTileAdd: ((ra: number, dec: number) => void) | null = null;
  private onMerge: ((movedId: string, targetId: string) => void) | null = null;

  constructor(host: FrameHost) {
    this.host = host;
  }

  // ── Accessors used by the renderer and the map ─────────────────────────────

  get frames(): RenderableFrame[] {
    return this.instances;
  }

  setFrames(frames: RenderableFrame[]): void {
    this.instances = frames;
  }

  get activeDrag(): FrameDrag | null {
    return this.drag;
  }

  get resizeDraft(): ResizeDraft | null {
    return this.draft;
  }

  get snapCandidate(): SnapCandidate | null {
    return this.snap;
  }

  get mosaicAddCandidates(): Array<{ ra: number; dec: number }> {
    return this.addCandidates;
  }

  setMosaicAddCandidates(c: Array<{ ra: number; dec: number }>): void {
    this.addCandidates = c;
  }

  setOnSelect(cb: (id: string | null) => void): void {
    this.onSelect = cb;
  }

  setOnChange(cb: (id: string, change: FovFrameChange) => void): void {
    this.onChange = cb;
  }

  setOnResize(cb: (id: string, region: FovFrameResizeRegion) => void): void {
    this.onResize = cb;
  }

  setOnTileRemove(cb: (tileId: string) => void): void {
    this.onTileRemove = cb;
  }

  setOnTileAdd(cb: (ra: number, dec: number) => void): void {
    this.onTileAdd = cb;
  }

  setOnMerge(cb: (movedId: string, targetId: string) => void): void {
    this.onMerge = cb;
  }

  // ── Frame canvas geometry ─────────────────────────────────────────────────
  // The maths lives in ./frame-geometry (pure, unit-tested); these thin wrappers
  // bind the live host view so the many call sites below stay unchanged.

  frameAnchorCanvas(f: RenderableFrame): { cx: number; cy: number } {
    return frameAnchorCanvas(f, this.host.view);
  }

  canvasRotDegToPa(rotDeg: number, raDeg: number, decDeg: number): number {
    return canvasRotDegToPa(rotDeg, raDeg, decDeg, this.host.view);
  }

  frameCanvasRotationDeg(f: RenderableFrame): number {
    return frameCanvasRotationDeg(f, this.host.view);
  }

  frameGeometry(f: RenderableFrame): FrameGeometry {
    return frameGeometry(f, this.host.view);
  }

  mosaicOutlinePath(f: RenderableFrame): Point[] | null {
    return mosaicOutlinePath(f, this.host.view);
  }

  frameHandlesVisible(halfW: number, halfH: number): boolean {
    return frameHandlesVisible(halfW, halfH);
  }

  /** Pin glyph position: the top-right corner lifted outward (local "up") so the
   * icon sits just above the frame with a small margin. */
  framePinGlyphPos(corner: Point, rotDeg: number): Point {
    return framePinGlyphPos(corner, rotDeg);
  }

  /** Whether a tile is large enough to host its delete/add button. */
  tileTrashVisible(halfW: number, halfH: number): boolean {
    return Math.min(halfW, halfH) >= 16; // only on tiles big enough that the icon fits
  }

  /** Whether the selected mosaic's tiles are large enough to host their edit
   * buttons (delete / add), and the canvas point of an add candidate. */
  mosaicEditButtonsVisible(mosaicId: string): boolean {
    const t = this.instances.find((f) => f.mosaicId === mosaicId);
    if (!t) return false;
    const g = this.frameGeometry(t);
    return this.tileTrashVisible(g.halfW, g.halfH);
  }

  /** The selected mosaic outline's rotate-handle position + centre, so add ("+")
   * buttons can be nudged clear of the rotation needle. Null when not applicable. */
  activeOutlineRotateAvoid(): { handle: Point; center: Point } | null {
    const outline = this.instances.find((f) => f.active && f.isMosaicOutline);
    if (!outline) return null;
    const geo = this.frameGeometry(outline);
    if (!this.frameHandlesVisible(geo.halfW, geo.halfH)) return null;
    return {
      handle: rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24),
      center: { x: geo.cx, y: geo.cy },
    };
  }

  /** Canvas point of an add candidate. If it would sit on the rotate needle, push
   * it outward (away from the mosaic centre) past the handle so it stays clickable. */
  candidateCanvasPoint(
    c: { ra: number; dec: number },
    avoid?: { handle: Point; center: Point } | null,
  ): Point {
    const p = project(c.ra, c.dec);
    let pt = toCanvas(p.x, p.y, this.host.view);
    if (avoid && Math.hypot(pt.x - avoid.handle.x, pt.y - avoid.handle.y) < TILE_TRASH_R * 2 + 4) {
      const dx = pt.x - avoid.center.x,
        dy = pt.y - avoid.center.y;
      const len = Math.hypot(dx, dy) || 1;
      const newDist =
        Math.hypot(avoid.handle.x - avoid.center.x, avoid.handle.y - avoid.center.y) +
        TILE_TRASH_R +
        14;
      pt = { x: avoid.center.x + (dx / len) * newDist, y: avoid.center.y + (dy / len) * newDist };
    }
    return pt;
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  /** Hit-test the active/instance frames on mousedown. Returns true if the event was consumed (no pan). */
  handleMouseDown(mx: number, my: number): boolean {
    if (!this.host.interactionEnabled || this.host.pickingMode || this.instances.length === 0)
      return false;

    const active = this.instances.find((f) => f.active);
    if (active && active.visible !== false) {
      const geo = this.frameGeometry(active);
      const handlesVisible = this.frameHandlesVisible(geo.halfW, geo.halfH);
      if (handlesVisible) {
        const rh = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24);
        if (isNearHandle(mx, my, rh, 9)) {
          this.drag = { id: active.id, mode: 'rotate' };
          return true;
        }
        if (active.pinnable) {
          const pinPos = this.framePinGlyphPos(geo.corners[1], geo.rotDeg);
          if (isNearHandle(mx, my, pinPos, 10)) {
            this.toggleFramePin(active);
            return true;
          }
        }
        // Corner resize handles (drag-to-extend into a mosaic) take priority over
        // the centre move dot and border move.
        if (active.resizable) {
          for (let i = 0; i < geo.corners.length; i++) {
            if (isNearHandle(mx, my, geo.corners[i], 9)) {
              this.drag = { id: active.id, mode: 'resize', corner: i };
              return true;
            }
          }
        }
        if (active.movable && isNearHandle(mx, my, { x: geo.cx, y: geo.cy }, 9)) {
          this.drag = { id: active.id, mode: 'move' };
          return true;
        }
      }
      // Dragging the border moves the active frame at any size.
      if (active.movable && isNearPolygonBorder(mx, my, geo.corners, 6)) {
        this.drag = { id: active.id, mode: 'move' };
        return true;
      }
      // Per-tile editing: the selected mosaic shows a delete button on each tile
      // and an add ("+") button at each empty neighbour cell.
      if (active.isMosaicOutline) {
        const mosaicId = active.id.split(':')[2];
        if (this.mosaicEditButtonsVisible(mosaicId)) {
          const avoid = this.activeOutlineRotateAvoid();
          for (const c of this.addCandidates) {
            if (isNearHandle(mx, my, this.candidateCanvasPoint(c, avoid), TILE_TRASH_R)) {
              this.onTileAdd?.(c.ra, c.dec);
              return true;
            }
          }
          for (const t of this.instances) {
            if (t.mosaicId !== mosaicId || !t.mosaicIsBorderTile) continue;
            const tg = this.frameGeometry(t);
            if (isNearHandle(mx, my, { x: tg.cx, y: tg.cy }, TILE_TRASH_R)) {
              this.onTileRemove?.(t.id);
              return true;
            }
          }
        }
      }
    }

    // Select a frame by clicking anywhere inside it (topmost first). Mosaic tiles
    // (mosaicId set) aren't selectable — the mosaic's outline frame is.
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const f = this.instances[i];
      if (f.active || f.visible === false || f.mosaicId) continue;
      const geo = this.frameGeometry(f);
      if (pointInConvexPolygon(mx, my, geo.corners)) {
        this.selectFrame(f.id);
        return true;
      }
    }

    // Clicked the interior / empty space: let the map pan. The active frame
    // stays selected (deselect explicitly via the popup or the Escape key) so
    // panning the sky under a floating frame never loses the selection.
    return false;
  }

  /** Apply a frame move/rotate/resize drag for the current cursor position. */
  handleDragMove(mx: number, my: number): void {
    if (!this.drag) return;
    const f = this.instances.find((x) => x.id === this.drag!.id);
    if (!f) {
      this.drag = null;
      return;
    }

    if (this.drag.mode === 'resize') {
      // Recompute the rubber-band rectangle from the (unchanged) frame geometry's
      // fixed corner and the cursor; nothing is committed until mouseup.
      const geo = this.frameGeometry(f);
      const r = resizeFromCorner(geo.corners, this.drag.corner ?? 2, mx, my, geo.rotDeg);
      let { halfW, halfH } = r;
      // Smart-scope frame: clamp the rubber band to the scope's mosaic envelope
      // live (per-axis cap + area cap). resizeFromCorner keeps the centre fixed,
      // so clamping the half-extents alone keeps the preview anchored.
      if (f.smartMosaic) {
        const reqWDeg = f.wDeg * (r.halfW / Math.max(1e-6, geo.halfW));
        const reqHDeg = f.hDeg * (r.halfH / Math.max(1e-6, geo.halfH));
        const c = clampSmartMosaicSize(
          reqWDeg,
          reqHDeg,
          f.smartMosaic.nativeWDeg,
          f.smartMosaic.nativeHDeg,
          f.smartMosaic.env,
        );
        halfW = (c.wDeg / Math.max(1e-6, f.wDeg)) * geo.halfW;
        halfH = (c.hDeg / Math.max(1e-6, f.hDeg)) * geo.halfH;
      }
      this.draft = { cx: r.cx, cy: r.cy, halfW, halfH, rotDeg: geo.rotDeg };
      this.host.requestRenderInteractive();
      return;
    }

    if (this.drag.mode === 'rotate') {
      const { cx, cy } = this.frameAnchorCanvas(f);
      const rotDeg = canvasRotationDegFromCursor(cx, cy, mx, my);
      if (f.anchorKind === 'sky') {
        const pa = this.canvasRotDegToPa(rotDeg, f.ra ?? 0, f.dec ?? 0);
        this.onChange?.(f.id, { paDeg: pa });
      } else {
        this.onChange?.(f.id, { screenRotationDeg: normalizeRotationDeg(rotDeg) });
      }
    } else {
      if (f.anchorKind === 'sky') {
        // Hold the frame's on-screen orientation fixed while moving: a pinned
        // frame's rotation is a position angle relative to celestial north,
        // whose screen direction changes across the projection — so without
        // this the frame would spin to stay north-aligned as it's dragged.
        const canvasRotDeg = this.frameCanvasRotationDeg(f);
        // The centre always follows the cursor exactly — no mid-drag jump. When
        // the anchor is on and a DSO is within snap range we only *record* it as
        // the pending snap target (drawn as the elastic line); the actual snap
        // happens on mouse-up via animateSnapToDso.
        const proj = fromCanvas(mx, my, this.host.view);
        const u = unproject(proj.x, proj.y);
        const ra = u.ra,
          dec = u.dec;
        let dsoId: string | null = null;
        const near = f.anchorSnap !== false ? this.host.findClosestDSO(mx, my) : null;
        // Recompute the PA so the frame keeps the same on-screen angle at the
        // new position.
        const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
        if (near) {
          this.snap = {
            id: near.id,
            ra: near.ra,
            dec: near.dec,
            majAxis: near.majAxis ?? 1,
          };
          // Keep the pending target *bound* while the elastic is shown. The centre
          // still follows the cursor (it springs to the DSO only on release), but
          // nulling the target here would, for a mosaic, drop its dsoId — flipping
          // its name to the gear spec and turning anchorSnap off, which then
          // toggles back on next frame and flickers. Binding it keeps identity stable.
          dsoId = near.id;
        } else {
          this.snap = null;
          // A plan/mosaic frame dragged out of snap range takes the DSO nearest
          // its centre that falls inside it (custom location if none).
          if (f.derivesTargetFromContent) {
            const moved: RenderableFrame = { ...f, ra, dec, paDeg };
            dsoId = frameTargetDso(this.host.dsosInFrame(moved).map((d) => d.id));
          }
        }
        // Emitting the change drives the re-render (via the store watch →
        // setFovInstances), which redraws the elastic from the frame's updated
        // centre. No explicit render() here — a synchronous one would paint the
        // line from the frame's stale (pre-change) position and flicker.
        this.onChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
      } else {
        this.onChange?.(f.id, {
          anchor: {
            kind: 'screen',
            nx: mx / this.host.view.width,
            ny: my / this.host.view.height,
          },
        });
      }
    }
  }

  /**
   * Release the mouse: commit a resize, spring a snapped move, or attempt a merge.
   * Clears the drag and snap state either way.
   */
  handleMouseUp(): void {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    const snap = this.snap;
    this.snap = null;
    if (drag.mode === 'resize') this.finalizeResize(drag.id);
    else if (drag.mode === 'move') {
      // Release within snap range: spring the frame to the DSO centre.
      if (snap) this.animateSnapToDso(drag.id, snap);
      // A standalone frame dropped onto another frame/mosaic of the same plan merges.
      else if (drag.id.startsWith('plan:')) this.checkFrameMerge(drag.id);
    }
    this.host.render();
  }

  /** True when at least one frame is selected (drives the Escape key handler). */
  hasActiveFrame(): boolean {
    return this.instances.some((f) => f.active);
  }

  /**
   * Abandon any in-progress drag, pending snap or running snap animation, so
   * deselecting can't leave a dangling elastic overlay or rAF.
   */
  clearInteraction(): void {
    this.drag = null;
    this.snap = null;
    this.cancelSnapAnim();
  }

  // ── Pin / anchor ──────────────────────────────────────────────────────────

  /** Toggle the pin state of a frame by id (used by the frame-manager popup). */
  toggleFramePinById(id: string): void {
    const f = this.instances.find((x) => x.id === id);
    if (f && f.pinnable) this.toggleFramePin(f);
  }

  /** Pin the currently-active frame if it is still floating (used when the
   * selection changes — only the selected frame stays free to move). */
  pinActiveIfFloating(): void {
    const active = this.instances.find((f) => f.active);
    if (active && active.pinnable && active.anchorKind === 'screen') this.toggleFramePin(active);
  }

  /** Change the active frame, auto-pinning the previously-active floating one. */
  selectFrame(id: string | null): void {
    this.pinActiveIfFloating();
    this.onSelect?.(id);
  }

  /**
   * Toggle a movable frame between floating (screen) and pinned (sky) at its
   * current centre. The on-screen orientation is preserved across the switch by
   * converting the rotation value (screen rotation ↔ position angle), so pinning
   * never appears to rotate the frame — it only changes the anchor.
   */
  private toggleFramePin(f: RenderableFrame): void {
    if (!f.pinnable) return;
    if (f.anchorKind === 'sky') {
      const { cx, cy } = this.frameAnchorCanvas(f);
      const canvasRotDeg = this.frameCanvasRotationDeg(f);
      // Pinned → floating: the canvas rotation becomes the screen rotation as-is.
      this.onChange?.(f.id, {
        anchor: {
          kind: 'screen',
          nx: cx / this.host.view.width,
          ny: cy / this.host.view.height,
        },
        screenRotationDeg: normalizeRotationDeg(canvasRotDeg),
      });
    } else {
      // Floating → pinned: snap to the nearest DSO when the anchor is on.
      this.pinFloatingFrame(f, f.anchorSnap !== false);
    }
  }

  /**
   * Pin a floating frame to the sky at its current centre, converting its canvas
   * rotation to a position angle so it stays visually put. When `snap` is true the
   * centre is anchored to the nearest DSO; when false it is pinned exactly where it
   * sits (used when freezing frames so nothing moves).
   */
  private pinFloatingFrame(f: RenderableFrame, snap: boolean): void {
    if (!f.pinnable || f.anchorKind !== 'screen') return;
    const { cx, cy } = this.frameAnchorCanvas(f);
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    let ra: number, dec: number, dsoId: string | null;
    const near = snap ? this.host.findClosestDSO(cx, cy) : null;
    if (near) {
      // Anchored: the snapped object sits at the centre, so it is the target.
      ra = near.ra;
      dec = near.dec;
      dsoId = near.id;
    } else {
      const proj = fromCanvas(cx, cy, this.host.view);
      const u = unproject(proj.x, proj.y);
      ra = u.ra;
      dec = u.dec;
      dsoId = null;
      // A plan frame placed freely takes the DSO nearest its centre that falls
      // inside it (custom location if none).
      if (f.derivesTargetFromContent) {
        const moved: RenderableFrame = { ...f, anchorKind: 'sky', ra, dec };
        dsoId = frameTargetDso(this.host.dsosInFrame(moved).map((d) => d.id));
      }
    }
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
    this.onChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
  }

  /**
   * Pin every floating frame to its exact current sky position (no DSO snap),
   * locking them to the sky so a later view change can't drift them. Called when
   * hiding all frames so nothing moves while the overlay is off.
   */
  pinAllFloatingFrames(): void {
    for (const f of this.instances) {
      if (f.pinnable && f.anchorKind === 'screen') this.pinFloatingFrame(f, false);
    }
  }

  /**
   * Re-run anchor detection on a pinned frame at its current centre and snap it
   * onto the nearest DSO when one is close enough — the same snap the pin action
   * applies with the anchor on. Used by the anchor toggle so turning the anchor
   * on re-anchors an already-pinned frame. No-op for floating frames or when no
   * DSO is close enough (the frame keeps its current position and target).
   */
  resnapFrame(id: string): void {
    const f = this.instances.find((x) => x.id === id);
    if (!f || !f.pinnable || f.anchorKind !== 'sky') return;
    const { cx, cy } = this.frameAnchorCanvas(f);
    const near = this.host.findClosestDSO(cx, cy);
    if (!near) return;
    // Keep the frame's on-screen orientation across the re-anchor by recomputing
    // the PA at the snapped object's RA.
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, near.ra, near.dec);
    this.onChange?.(f.id, {
      anchor: { kind: 'sky', ra: near.ra, dec: near.dec, dsoId: near.id },
      paDeg,
    });
  }

  /** Cancel any in-flight frame snap-back animation. */
  cancelSnapAnim(): void {
    if (this.snapAnim) {
      cancelAnimationFrame(this.snapAnim.raf);
      this.snapAnim = null;
    }
  }

  /**
   * Spring a just-dropped frame from its current (cursor) centre to the snap
   * target's DSO centre over a short ease-out, then commit the anchor with the
   * DSO as its target. The frame's on-screen orientation is held by recomputing
   * the PA at each interpolated RA (as the drag does).
   */
  private animateSnapToDso(id: string, snap: { id: string; ra: number; dec: number }): void {
    this.cancelSnapAnim();
    const f = this.instances.find((x) => x.id === id);
    if (!f || f.anchorKind !== 'sky') return;
    const startRa = f.ra ?? snap.ra;
    const startDec = f.dec ?? snap.dec;
    // Shortest-arc RA delta so a wrap across 0/360 doesn't sweep the long way.
    let dRa = snap.ra - startRa;
    if (dRa > 180) dRa -= 360;
    else if (dRa < -180) dRa += 360;
    const dDec = snap.dec - startDec;
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    const duration = 150;
    const startTime = performance.now();

    const step = (now: number) => {
      let t = (now - startTime) / duration;
      if (t >= 1) t = 1;
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const ra = normalizeRA(startRa + dRa * ease);
      const dec = startDec + dDec * ease;
      const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
      const done = t >= 1;
      // Keep the DSO target bound for every frame of the spring (it's known the
      // whole time); a null mid-flight would flip a mosaic's name to the gear spec.
      this.onChange?.(id, {
        anchor: {
          kind: 'sky',
          ra: done ? snap.ra : ra,
          dec: done ? snap.dec : dec,
          dsoId: snap.id,
        },
        paDeg,
      });
      if (done) {
        this.snapAnim = null;
      } else {
        this.snapAnim = { id, raf: requestAnimationFrame(step) };
      }
    };
    this.snapAnim = { id, raf: requestAnimationFrame(step) };
  }

  /**
   * Bring the given frame to the centre of the view (used by the frame manager).
   * Idempotent: a pinned frame pans the view to its sky anchor; a floating frame
   * snaps its own screen anchor back to the viewport centre.
   */
  centerFrameInView(id: string): void {
    const f = this.instances.find((x) => x.id === id);
    if (!f) return;
    if (f.anchorKind === 'sky') {
      // Same framing zoom the targets "view on map" button uses.
      const minDim = Math.min(this.host.view.width, this.host.view.height);
      const scale = computeFovTargetScale(f.wDeg, f.hDeg, f.dec ?? 0, getHemisphere(), minDim);
      this.host.navigateTo(f.ra ?? 0, f.dec ?? 0, scale, true);
    } else {
      this.onChange?.(f.id, { anchor: { kind: 'screen', nx: 0.5, ny: 0.5 } });
    }
  }

  /** After moving a standalone plan frame, merge it if it now overlaps another
   * frame or a mosaic of the same plan (emits the merge for the store to apply). */
  private checkFrameMerge(movedId: string): void {
    if (!this.onMerge) return;
    const targetId = findMergeTarget(movedId, this.instances, this.host.view);
    if (targetId) this.onMerge(movedId, targetId);
  }

  /**
   * Commit a drag-to-extend: convert the rubber-band rectangle to a sky region
   * (centre + angular size + PA) and hand it to the resize callback, which builds
   * the mosaic. The angular size scales the frame's single-tile FOV by the px
   * ratio (so it stays correct at the frame's location). No-op for a drag that
   * barely changed the size.
   */
  private finalizeResize(frameId: string): void {
    const draft = this.draft;
    this.draft = null;
    const f = draft ? this.instances.find((x) => x.id === frameId) : undefined;
    if (!draft || !f) {
      this.host.render();
      return;
    }
    const region = resizeRegionFromDraft(f, draft, this.host.view, fromCanvas, unproject);
    this.host.render();
    this.onResize?.(f.id, region);
  }
}
