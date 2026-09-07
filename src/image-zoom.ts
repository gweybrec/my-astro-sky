import { t } from './i18n';

export interface ZoomPanState {
  scale: number;
  tx: number;
  ty: number;
}

export interface ZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  /** Replace the single ⟲ reset button with explicit "Fit" + "1:1" buttons. */
  fitButtons?: boolean;
  /** Once the image has loaded and been laid out, run Fit once (ideal default framing). */
  fitOnLoad?: boolean;
  /**
   * What double-clicking the image does. Defaults to `'reset'` when `fitButtons` is off,
   * `'fit'` when it is on. `'none'` disables the double-click handler entirely.
   */
  dblClick?: 'fit' | 'reset' | 'none';
}

export interface ZoomPanController {
  controls: HTMLElement;
  getState(): ZoomPanState;
  onTransformChange(cb: () => void): () => void;
  readonly wasDrag: boolean;
  /** Scale to fill the display area while fully visible, then centre. */
  fit(): void;
  /** Scale to native pixel size (1 image px = 1 screen px), then centre. */
  actualSize(): void;
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
  const useFitButtons = opts?.fitButtons ?? false;
  const dblClickMode = opts?.dblClick ?? (useFitButtons ? 'fit' : 'reset');

  let scale = 1,
    tx = 0,
    ty = 0;
  let dragging = false,
    lastX = 0,
    lastY = 0,
    dragDist = 0;
  let _wasDrag = false;
  let fitRaf = 0;
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
    b.setAttribute('aria-label', title);
    return b;
  }

  const zoomOutBtn = makeBtn('−', t('gallery.zoom.out'), 'gallery-zoom-out');
  const zoomInBtn = makeBtn('+', t('gallery.zoom.in'), 'gallery-zoom-in');

  let resetBtn: HTMLButtonElement | null = null;
  let fitBtn: HTMLButtonElement | null = null;
  let oneToOneBtn: HTMLButtonElement | null = null;

  if (useFitButtons) {
    fitBtn = makeBtn(
      t('gallery.zoom.fit'),
      t('gallery.zoom.fitTitle'),
      'gallery-zoom-text gallery-zoom-fit',
    );
    oneToOneBtn = makeBtn(
      t('gallery.zoom.actual'),
      t('gallery.zoom.actualTitle'),
      'gallery-zoom-text gallery-zoom-11',
    );
    controls.append(zoomOutBtn, fitBtn, oneToOneBtn, zoomInBtn);
  } else {
    resetBtn = makeBtn('⟲', t('gallery.zoom.reset'), 'gallery-zoom-reset');
    controls.append(zoomOutBtn, resetBtn, zoomInBtn);
  }

  // ── Transform ───────────────────────────────────────────────────────────────
  function applyTransform() {
    img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    for (const cb of listeners) cb();
  }

  // ── Geometry ────────────────────────────────────────────────────────────────
  /** Client-space content box of the container (the visible image area, minus padding). */
  function contentBox(): { left: number; top: number; width: number; height: number } {
    const rect = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    return {
      left: rect.left + padL,
      top: rect.top + padT,
      width: rect.width - padL - padR,
      height: rect.height - padT - padB,
    };
  }

  /** Client-space centre of the container's content box. */
  function displayCentre(): { x: number; y: number } {
    const box = contentBox();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  // ── Zoom toward a point ─────────────────────────────────────────────────────
  /**
   * Zoom by `factor`, holding the image pixel currently under client point
   * (`clientX`, `clientY`) fixed — the behaviour of a mouse wheel at that point.
   *
   * The cursor is measured from the image's own top-left corner (its transform origin),
   * not the container. The <img> is flex-centred in the wrapper, so the two differ by the
   * centring offset — feeding container coords made the zoom lurch toward the top-left,
   * badly so for images smaller than the viewport. With transform-origin '0 0', scaling
   * never moves the left/top edge, so imgRect.left already includes tx.
   */
  function zoomTowardClientPoint(factor: number, clientX: number, clientY: number) {
    const imgRect = img.getBoundingClientRect();
    const next = applyZoomToward(
      { scale, tx, ty },
      { cx: clientX - imgRect.left + tx, cy: clientY - imgRect.top + ty },
      factor,
      MIN_SCALE,
      MAX_SCALE,
    );
    ({ scale, tx, ty } = next);
    applyTransform();
  }

  /** Set an absolute scale and centre the image in the container's content box. */
  function applyAbsoluteScaleCentered(targetScale: number) {
    const cRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const layoutW = imgRect.width / scale;
    const layoutH = imgRect.height / scale;
    if (!(layoutW > 0) || !(layoutH > 0) || !Number.isFinite(targetScale) || targetScale <= 0) {
      return;
    }
    const offX = imgRect.left - cRect.left - tx;
    const offY = imgRect.top - cRect.top - ty;
    const box = contentBox();
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
    tx = box.left - cRect.left + box.width / 2 - offX - (layoutW / 2) * scale;
    ty = box.top - cRect.top + box.height / 2 - offY - (layoutH / 2) * scale;
    applyTransform();
  }

  /** Largest scale that keeps the whole image inside the content box. */
  function fitToArea() {
    const imgRect = img.getBoundingClientRect();
    const layoutW = imgRect.width / scale;
    const layoutH = imgRect.height / scale;
    if (!(layoutW > 0) || !(layoutH > 0)) return;
    const box = contentBox();
    applyAbsoluteScaleCentered(Math.min(box.width / layoutW, box.height / layoutH));
  }

  /** Native pixel size: 1 image pixel == 1 screen pixel. */
  function actualSize() {
    const imgRect = img.getBoundingClientRect();
    const layoutW = imgRect.width / scale;
    if (!(layoutW > 0)) return;
    const nat = (img as HTMLImageElement).naturalWidth || layoutW;
    applyAbsoluteScaleCentered(nat / layoutW);
  }

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  // ── Wheel ───────────────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoomTowardClientPoint(e.deltaY < 0 ? 1.12 : 0.9, e.clientX, e.clientY);
  }

  // ── Pointer drag ─────────────────────────────────────────────────────────────
  function onPointerDown(ev: PointerEvent) {
    if ((ev.target as HTMLElement).closest('.gallery-zoom-controls')) return;
    try {
      container.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
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
    try {
      container.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    _wasDrag = dragDist > 5;
    dragging = false;
    // Reset after click handler has had a chance to read wasDrag
    setTimeout(() => {
      _wasDrag = false;
    }, 0);
  }

  function onPointerCancel(ev: PointerEvent) {
    onPointerUp(ev);
  }

  // ── Double-click ────────────────────────────────────────────────────────────
  // Bound to `container`, not `img`: the drag handler calls setPointerCapture() on the
  // container, which retargets the derived click/dblclick events to it, so a listener on
  // `img` would never fire.
  function onDblClick(ev: MouseEvent) {
    if ((ev.target as HTMLElement).closest('.gallery-zoom-controls')) return;
    if (_wasDrag) return;
    if (dblClickMode === 'fit') fitToArea();
    else if (dblClickMode === 'reset') reset();
  }

  // ── Button handlers ─────────────────────────────────────────────────────────
  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = displayCentre();
    zoomTowardClientPoint(1.25, c.x, c.y);
  });
  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = displayCentre();
    zoomTowardClientPoint(0.8, c.x, c.y);
  });
  resetBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    reset();
  });
  fitBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    fitToArea();
  });
  oneToOneBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    actualSize();
  });

  // ── Attach listeners ────────────────────────────────────────────────────────
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  if (dblClickMode !== 'none') container.addEventListener('dblclick', onDblClick);

  // ── Fit on load ─────────────────────────────────────────────────────────────
  // createImageZoomPan runs before the caller appends its overlay to the DOM, so the
  // container has no layout yet — defer one frame before measuring.
  const runFitOnLoad = () => {
    fitRaf = requestAnimationFrame(() => fitToArea());
  };
  if (opts?.fitOnLoad) {
    if (img instanceof HTMLImageElement && !img.complete) {
      img.addEventListener('load', runFitOnLoad, { once: true });
    } else {
      runFitOnLoad();
    }
  }

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
    get wasDrag() {
      return _wasDrag;
    },
    fit: fitToArea,
    actualSize,
    reset,
    destroy() {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      img.removeEventListener('load', runFitOnLoad);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('dblclick', onDblClick);
      controls.remove();
      listeners.length = 0;
    },
  };
}
