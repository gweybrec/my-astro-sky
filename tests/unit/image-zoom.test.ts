import { describe, it, expect, vi } from 'vitest';
import { applyZoomToward, createImageZoomPan } from '../../src/image-zoom';

describe('applyZoomToward', () => {
  const MIN = 0.2;
  const MAX = 6;

  it('zoom in at the current translate origin leaves tx/ty unchanged', () => {
    const state = { scale: 1, tx: 50, ty: 30 };
    const result = applyZoomToward(state, { cx: 50, cy: 30 }, 1.12, MIN, MAX);
    expect(result.scale).toBeCloseTo(1.12);
    expect(result.tx).toBeCloseTo(50);
    expect(result.ty).toBeCloseTo(30);
  });

  it('zoom in at origin (0,0) with no existing translate moves tx/ty toward zero', () => {
    const state = { scale: 1, tx: 0, ty: 0 };
    const result = applyZoomToward(state, { cx: 0, cy: 0 }, 1.12, MIN, MAX);
    expect(result.scale).toBeCloseTo(1.12);
    expect(result.tx).toBeCloseTo(0);
    expect(result.ty).toBeCloseTo(0);
  });

  it('clamps scale at maxScale and adjusts translate correctly', () => {
    const state = { scale: 5.9, tx: 10, ty: 10 };
    const result = applyZoomToward(state, { cx: 100, cy: 100 }, 1.5, MIN, MAX);
    expect(result.scale).toBe(MAX);
    // translate should still shift to zoom toward cursor
    expect(result.tx).not.toBe(state.tx);
  });

  it('clamps scale at minScale', () => {
    const state = { scale: 0.25, tx: 0, ty: 0 };
    const result = applyZoomToward(state, { cx: 50, cy: 50 }, 0.5, MIN, MAX);
    expect(result.scale).toBe(MIN);
  });

  it('point under cursor stays fixed in image space after zoom', () => {
    const state = { scale: 1, tx: 0, ty: 0 };
    const cursor = { cx: 200, cy: 150 };
    const factor = 1.12;
    const result = applyZoomToward(state, cursor, factor, MIN, MAX);

    // The point under the cursor in image space = (cursor - tx) / scale
    const imgXBefore = (cursor.cx - state.tx) / state.scale;
    const imgYBefore = (cursor.cy - state.ty) / state.scale;
    const imgXAfter = (cursor.cx - result.tx) / result.scale;
    const imgYAfter = (cursor.cy - result.ty) / result.scale;

    expect(imgXAfter).toBeCloseTo(imgXBefore, 8);
    expect(imgYAfter).toBeCloseTo(imgYBefore, 8);
  });

  it('invariant holds at arbitrary pan offset', () => {
    const state = { scale: 2, tx: -80, ty: 40 };
    const cursor = { cx: 300, cy: 200 };
    const factor = 0.9;
    const result = applyZoomToward(state, cursor, factor, MIN, MAX);

    const imgXBefore = (cursor.cx - state.tx) / state.scale;
    const imgYBefore = (cursor.cy - state.ty) / state.scale;
    const imgXAfter = (cursor.cx - result.tx) / result.scale;
    const imgYAfter = (cursor.cy - result.ty) / result.scale;

    expect(imgXAfter).toBeCloseTo(imgXBefore, 8);
    expect(imgYAfter).toBeCloseTo(imgYBefore, 8);
  });
});

interface SetupOpts {
  containerW?: number;
  containerH?: number;
  /** Untransformed layout box of the <img> within the container. */
  imgLeft?: number;
  imgTop?: number;
  imgW?: number;
  imgH?: number;
  /** Reserved right-hand pane (metadata) the display area excludes. */
  paddingRight?: number;
  /** Intrinsic pixel size reported by the <img>. */
  naturalWidth?: number;
  naturalHeight?: number;
  fitButtons?: boolean;
  fitOnLoad?: boolean;
  dblClick?: 'fit' | 'reset' | 'none';
}

// Model an image flex-centred inside a larger container. transform-origin is '0 0', so
// scaling never moves the image's left/top edge — only translate does. The stub parses
// the exact string applyTransform() writes rather than lean on happy-dom's DOMMatrix,
// which parses translate()/scale() notation inconsistently.
function setup(opts: SetupOpts = {}) {
  const containerW = opts.containerW ?? 1000;
  const containerH = opts.containerH ?? 800;
  const imgLeft = opts.imgLeft ?? 400;
  const imgTop = opts.imgTop ?? 300;
  const imgW = opts.imgW ?? 200;
  const imgH = opts.imgH ?? 200;

  const container = document.createElement('div');
  const img = document.createElement('img');
  container.appendChild(img);
  document.body.appendChild(container);
  if (opts.paddingRight) container.style.paddingRight = `${opts.paddingRight}px`;
  if (opts.naturalWidth !== undefined) {
    Object.defineProperty(img, 'naturalWidth', { value: opts.naturalWidth, configurable: true });
  }
  if (opts.naturalHeight !== undefined) {
    Object.defineProperty(img, 'naturalHeight', { value: opts.naturalHeight, configurable: true });
  }

  container.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: containerW,
    height: containerH,
    right: containerW,
    bottom: containerH,
    x: 0,
    y: 0,
    toJSON() {},
  })) as never;

  img.getBoundingClientRect = vi.fn(() => {
    const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(img.style.transform);
    const sc = /scale\(([-\d.]+)\)/.exec(img.style.transform);
    const tx = tr ? parseFloat(tr[1]) : 0;
    const ty = tr ? parseFloat(tr[2]) : 0;
    const scale = sc ? parseFloat(sc[1]) : 1;
    const left = imgLeft + tx;
    const top = imgTop + ty;
    return {
      left,
      top,
      width: imgW * scale,
      height: imgH * scale,
      right: left + imgW * scale,
      bottom: top + imgH * scale,
      x: left,
      y: top,
      toJSON() {},
    };
  }) as never;

  const zoom = createImageZoomPan(img, container, {
    fitButtons: opts.fitButtons,
    fitOnLoad: opts.fitOnLoad,
    dblClick: opts.dblClick,
    ...(opts.fitButtons ? { maxScale: 16 } : {}),
  });
  return { container, img, zoom };
}

/** Image-local pixel currently under a client-space point. */
function localUnder(img: HTMLElement, scale: number, clientX: number, clientY: number) {
  const r = img.getBoundingClientRect();
  return { lx: (clientX - r.left) / scale, ly: (clientY - r.top) / scale };
}

function wheelAt(container: HTMLElement, clientX: number, clientY: number, deltaY: number) {
  // happy-dom's WheelEvent init drops clientX/clientY (it doesn't mix in MouseEventInit),
  // so pin them on the instance explicitly.
  const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
  Object.defineProperty(e, 'clientX', { value: clientX });
  Object.defineProperty(e, 'clientY', { value: clientY });
  container.dispatchEvent(e);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

describe('createImageZoomPan onWheel', () => {
  it.each([
    { name: 'cursor at image centre', clientX: 500, clientY: 400 },
    { name: 'cursor off-centre', clientX: 450, clientY: 360 },
    { name: 'cursor near a corner', clientX: 410, clientY: 490 },
  ])('keeps the pixel under the cursor fixed ($name)', ({ clientX, clientY }) => {
    const { container, img, zoom } = setup();

    const rectBefore = img.getBoundingClientRect();
    const s0 = zoom.getState().scale;
    const imgXBefore = (clientX - rectBefore.left) / s0;
    const imgYBefore = (clientY - rectBefore.top) / s0;

    wheelAt(container, clientX, clientY, -100); // zoom in

    const rectAfter = img.getBoundingClientRect();
    const s1 = zoom.getState().scale;
    expect(s1).toBeGreaterThan(s0);

    const imgXAfter = (clientX - rectAfter.left) / s1;
    const imgYAfter = (clientY - rectAfter.top) / s1;

    expect(imgXAfter).toBeCloseTo(imgXBefore, 6);
    expect(imgYAfter).toBeCloseTo(imgYBefore, 6);

    zoom.destroy();
  });

  it('holds the cursor anchor across several successive wheel steps', () => {
    const { container, img, zoom } = setup();
    const clientX = 470;
    const clientY = 420;

    const r0 = img.getBoundingClientRect();
    const imgX0 = (clientX - r0.left) / zoom.getState().scale;
    const imgY0 = (clientY - r0.top) / zoom.getState().scale;

    for (let i = 0; i < 5; i++) wheelAt(container, clientX, clientY, -100);

    const r1 = img.getBoundingClientRect();
    const s1 = zoom.getState().scale;
    expect((clientX - r1.left) / s1).toBeCloseTo(imgX0, 5);
    expect((clientY - r1.top) / s1).toBeCloseTo(imgY0, 5);

    zoom.destroy();
  });
});

describe('createImageZoomPan +/- buttons', () => {
  function btn(zoom: ReturnType<typeof createImageZoomPan>, cls: string): HTMLButtonElement {
    return zoom.controls.querySelector<HTMLButtonElement>(`button.${cls}`)!;
  }

  // Container 1000×800 with a 340px right pane reserved, so the display area is x:[0,660];
  // its centre is (330, 400). The image spans [250,450]×[320,520], covering that centre.
  const CENTRE = { x: 330, y: 400 };
  const opts = { paddingRight: 340, imgLeft: 250, imgTop: 320 };

  it('zoom-in button holds the display-area centre fixed', () => {
    const { zoom, img } = setup(opts);
    const before = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);

    btn(zoom, 'gallery-zoom-in').click();

    const s1 = zoom.getState().scale;
    expect(s1).toBeGreaterThan(1);
    const after = localUnder(img, s1, CENTRE.x, CENTRE.y);
    expect(after.lx).toBeCloseTo(before.lx, 6);
    expect(after.ly).toBeCloseTo(before.ly, 6);
    zoom.destroy();
  });

  it('zoom-out button holds the display-area centre fixed', () => {
    const { zoom, img } = setup(opts);
    const before = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);

    btn(zoom, 'gallery-zoom-out').click();

    const s1 = zoom.getState().scale;
    expect(s1).toBeLessThan(1);
    const after = localUnder(img, s1, CENTRE.x, CENTRE.y);
    expect(after.lx).toBeCloseTo(before.lx, 6);
    expect(after.ly).toBeCloseTo(before.ly, 6);
    zoom.destroy();
  });

  it('the centre stays fixed across a run of alternating button clicks', () => {
    const { zoom, img } = setup(opts);
    const before = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);

    for (let i = 0; i < 4; i++) btn(zoom, 'gallery-zoom-in').click();
    for (let i = 0; i < 6; i++) btn(zoom, 'gallery-zoom-out').click();

    const after = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);
    expect(after.lx).toBeCloseTo(before.lx, 5);
    expect(after.ly).toBeCloseTo(before.ly, 5);
    zoom.destroy();
  });

  it('with no reserved pane the anchor is the full container centre', () => {
    // default layout: container centre (500, 400), image [400,600]×[300,500] covers it.
    const { zoom, img } = setup();
    const before = localUnder(img, zoom.getState().scale, 500, 400);

    btn(zoom, 'gallery-zoom-in').click();

    const after = localUnder(img, zoom.getState().scale, 500, 400);
    expect(after.lx).toBeCloseTo(before.lx, 6);
    expect(after.ly).toBeCloseTo(before.ly, 6);
    zoom.destroy();
  });
});

describe('createImageZoomPan Fit / 1:1', () => {
  const fitBtn = (z: ReturnType<typeof createImageZoomPan>) =>
    z.controls.querySelector<HTMLButtonElement>('button.gallery-zoom-fit')!;
  const oneToOneBtn = (z: ReturnType<typeof createImageZoomPan>) =>
    z.controls.querySelector<HTMLButtonElement>('button.gallery-zoom-11')!;

  /** Client-space centre of the current image bounding box. */
  function imgCentre(img: HTMLElement) {
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  it('renders 4 buttons in order [− Fit 1:1 +] when fitButtons is set', () => {
    const { zoom } = setup({ fitButtons: true });
    const classes = [...zoom.controls.querySelectorAll('button')].map((b) => b.className);
    expect(classes).toHaveLength(4);
    expect(classes[0]).toContain('gallery-zoom-out');
    expect(classes[1]).toContain('gallery-zoom-fit');
    expect(classes[2]).toContain('gallery-zoom-11');
    expect(classes[3]).toContain('gallery-zoom-in');
    expect(zoom.controls.querySelector('.gallery-zoom-reset')).toBeNull();
    zoom.destroy();
  });

  it('keeps the ⟲ reset button when fitButtons is not set', () => {
    const { zoom } = setup();
    expect([...zoom.controls.querySelectorAll('button')]).toHaveLength(3);
    expect(zoom.controls.querySelector('.gallery-zoom-reset')).not.toBeNull();
    zoom.destroy();
  });

  it('Fit enlarges a small image to fill the area and centres it', () => {
    // container 1000×800, layout 200×200 → fit scale = min(1000/200, 800/200) = 4
    const { zoom, img } = setup({ fitButtons: true, imgW: 200, imgH: 200 });
    fitBtn(zoom).click();

    expect(zoom.getState().scale).toBeCloseTo(4, 6);
    const c = imgCentre(img);
    expect(c.x).toBeCloseTo(500, 4); // container content-box centre
    expect(c.y).toBeCloseTo(400, 4);
    zoom.destroy();
  });

  it('Fit respects a reserved pane (display area excludes padding-right)', () => {
    // area = 660×800 → fit scale = min(660/200, 800/200) = 3.3; centre x = 330
    const { zoom, img } = setup({ fitButtons: true, paddingRight: 340, imgW: 200, imgH: 200 });
    fitBtn(zoom).click();

    expect(zoom.getState().scale).toBeCloseTo(3.3, 6);
    const c = imgCentre(img);
    expect(c.x).toBeCloseTo(330, 4);
    expect(c.y).toBeCloseTo(400, 4);
    zoom.destroy();
  });

  it('Fit on an already-fitting image gives scale ≈ 1', () => {
    const { zoom } = setup({
      fitButtons: true,
      containerW: 200,
      containerH: 200,
      imgW: 200,
      imgH: 200,
    });
    fitBtn(zoom).click();
    expect(zoom.getState().scale).toBeCloseTo(1, 6);
    zoom.destroy();
  });

  it('1:1 scales a high-res image to native pixels, centred and clipping', () => {
    // layout 200 wide, natural 600 → scale = 3
    const { zoom, img } = setup({
      fitButtons: true,
      imgW: 200,
      imgH: 150,
      naturalWidth: 600,
      naturalHeight: 450,
    });
    oneToOneBtn(zoom).click();

    expect(zoom.getState().scale).toBeCloseTo(3, 6);
    const r = img.getBoundingClientRect();
    expect(r.width).toBeCloseTo(600, 4); // == naturalWidth
    const c = imgCentre(img);
    expect(c.x).toBeCloseTo(500, 4);
    expect(c.y).toBeCloseTo(400, 4);
    zoom.destroy();
  });

  it('1:1 shows a sub-viewport image smaller than fit, centred', () => {
    // layout 200 wide, natural 120 → scale = 0.6
    const { zoom, img } = setup({
      fitButtons: true,
      imgW: 200,
      imgH: 200,
      naturalWidth: 120,
      naturalHeight: 120,
    });
    oneToOneBtn(zoom).click();

    expect(zoom.getState().scale).toBeCloseTo(0.6, 6);
    const c = imgCentre(img);
    expect(c.x).toBeCloseTo(500, 4);
    expect(c.y).toBeCloseTo(400, 4);
    zoom.destroy();
  });

  it('fitOnLoad applies the fit scale after the image loads and a frame passes', async () => {
    const { zoom, img } = setup({ fitButtons: true, fitOnLoad: true, imgW: 200, imgH: 200 });
    expect(zoom.getState().scale).toBe(1); // deferred, not synchronous
    img.dispatchEvent(new Event('load')); // no-op if the image was already complete
    await nextFrame();
    expect(zoom.getState().scale).toBeCloseTo(4, 6);
    zoom.destroy();
  });

  // The handler is bound to the container, not the image: the drag handler's
  // setPointerCapture() on the container retargets derived click/dblclick events to it,
  // so a listener on the image would never fire.
  it("double-click on the container fits when dblClick is 'fit' (the fitButtons default)", () => {
    const { zoom, container } = setup({ fitButtons: true, imgW: 200, imgH: 200 });
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(zoom.getState().scale).toBeCloseTo(4, 6);
    zoom.destroy();
  });

  it('double-click is ignored right after a drag', () => {
    const { zoom, container } = setup({ fitButtons: true, imgW: 200, imgH: 200 });
    const down = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 });
    Object.defineProperty(down, 'clientX', { value: 100 });
    Object.defineProperty(down, 'clientY', { value: 100 });
    container.dispatchEvent(down);
    const move = new PointerEvent('pointermove', { bubbles: true, pointerId: 1 });
    Object.defineProperty(move, 'clientX', { value: 160 });
    Object.defineProperty(move, 'clientY', { value: 140 });
    container.dispatchEvent(move);
    container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(zoom.getState().scale).toBe(1); // drag guard blocked the fit
    zoom.destroy();
  });

  it("double-click is inert when dblClick is 'none'", () => {
    const { zoom, container } = setup({ fitButtons: true, dblClick: 'none', imgW: 200, imgH: 200 });
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(zoom.getState().scale).toBe(1);
    zoom.destroy();
  });

  it('controller exposes fit() and actualSize()', () => {
    const { zoom } = setup({
      fitButtons: true,
      imgW: 200,
      imgH: 200,
      naturalWidth: 600,
      naturalHeight: 600,
    });
    zoom.fit();
    expect(zoom.getState().scale).toBeCloseTo(4, 6);
    zoom.actualSize();
    expect(zoom.getState().scale).toBeCloseTo(3, 6);
    zoom.destroy();
  });
});
