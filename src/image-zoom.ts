export interface ZoomPanState { scale: number; tx: number; ty: number; }

export interface ZoomPanOptions {
  minScale?: number;
  maxScale?: number;
}

export interface ZoomPanController {
  controls: HTMLElement;
  getState(): ZoomPanState;
  onTransformChange(cb: () => void): () => void;
  readonly wasDrag: boolean;
  reset(): void;
  destroy(): void;
}

/** Pure helper: compute new zoom state when zooming by `factor` toward `cursor`. */
export function applyZoomToward(
  state: ZoomPanState,
  cursor: { cx: number; cy: number },
  factor: number,
  minScale: number,
  maxScale: number,
): ZoomPanState {
  const prev = state.scale;
  const scale = Math.max(minScale, Math.min(maxScale, prev * factor));
  return {
    scale,
    tx: state.tx + (cursor.cx - state.tx) * (1 - scale / prev),
    ty: state.ty + (cursor.cy - state.ty) * (1 - scale / prev),
  };
}

export function createImageZoomPan(
  img: HTMLElement,
  container: HTMLElement,
  opts?: ZoomPanOptions,
): ZoomPanController {
  const MIN_SCALE = opts?.minScale ?? 0.2;
  const MAX_SCALE = opts?.maxScale ?? 6;

  let scale = 1, tx = 0, ty = 0;
  let dragging = false, lastX = 0, lastY = 0, dragDist = 0;
  let _wasDrag = false;
  const listeners: Array<() => void> = [];

  img.style.transformOrigin = '0 0';

  // ── Controls DOM ────────────────────────────────────────────────────────────
  const controls = document.createElement('div');
  controls.className = 'gallery-zoom-controls';

  function makeBtn(text: string, title: string, extraClass = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'gallery-zoom-btn' + (extraClass ? ' ' + extraClass : '');
    b.textContent = text;
    b.title = title;
    return b;
  }

  const zoomOutBtn = makeBtn('−', 'Zoom out');
  const resetBtn   = makeBtn('⟲', 'Reset', 'gallery-zoom-reset');
  const zoomInBtn  = makeBtn('+', 'Zoom in');
  controls.append(zoomOutBtn, resetBtn, zoomInBtn);

  // ── Transform ───────────────────────────────────────────────────────────────
  function applyTransform() {
    img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    for (const cb of listeners) cb();
  }

  // ── Wheel ───────────────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const next = applyZoomToward(
      { scale, tx, ty },
      { cx: e.clientX - rect.left, cy: e.clientY - rect.top },
      e.deltaY < 0 ? 1.12 : 0.9,
      MIN_SCALE,
      MAX_SCALE,
    );
    ({ scale, tx, ty } = next);
    applyTransform();
  }

  // ── Pointer drag ─────────────────────────────────────────────────────────────
  function onPointerDown(ev: PointerEvent) {
    if ((ev.target as HTMLElement).closest('.gallery-zoom-controls')) return;
    try { container.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    dragging = true;
    dragDist = 0;
    lastX = ev.clientX;
    lastY = ev.clientY;
  }

  function onPointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    tx += dx;
    ty += dy;
    dragDist += Math.abs(dx) + Math.abs(dy);
    lastX = ev.clientX;
    lastY = ev.clientY;
    applyTransform();
  }

  function onPointerUp(ev: PointerEvent) {
    try { container.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    _wasDrag = dragDist > 5;
    dragging = false;
    // Reset after click handler has had a chance to read wasDrag
    setTimeout(() => { _wasDrag = false; }, 0);
  }

  function onPointerCancel(ev: PointerEvent) {
    onPointerUp(ev);
  }

  // ── Double-click reset ──────────────────────────────────────────────────────
  function onDblClick() {
    scale = 1; tx = 0; ty = 0;
    applyTransform();
  }

  // ── Button handlers ─────────────────────────────────────────────────────────
  zoomInBtn.addEventListener('click',  (e) => { e.stopPropagation(); scale = Math.min(MAX_SCALE, scale * 1.25); applyTransform(); });
  zoomOutBtn.addEventListener('click', (e) => { e.stopPropagation(); scale = Math.max(MIN_SCALE, scale * 0.8);  applyTransform(); });
  resetBtn.addEventListener('click',   (e) => { e.stopPropagation(); scale = 1; tx = 0; ty = 0; applyTransform(); });

  // ── Attach listeners ────────────────────────────────────────────────────────
  container.addEventListener('wheel',         onWheel, { passive: false });
  container.addEventListener('pointerdown',   onPointerDown);
  container.addEventListener('pointermove',   onPointerMove);
  container.addEventListener('pointerup',     onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  img.addEventListener('dblclick', onDblClick);

  return {
    controls,
    getState: () => ({ scale, tx, ty }),
    onTransformChange(cb) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    get wasDrag() { return _wasDrag; },
    reset() { scale = 1; tx = 0; ty = 0; applyTransform(); },
    destroy() {
      container.removeEventListener('wheel',         onWheel);
      container.removeEventListener('pointerdown',   onPointerDown);
      container.removeEventListener('pointermove',   onPointerMove);
      container.removeEventListener('pointerup',     onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      img.removeEventListener('dblclick', onDblClick);
      controls.remove();
      listeners.length = 0;
    },
  };
}
