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

// Model a small image flex-centred inside a larger container: the image's top-left is
// offset from the container origin, which is exactly what used to break the zoom.
const CONTAINER = { left: 0, top: 0, width: 1000, height: 800 };
const IMG_W = 200;
const IMG_H = 200;

interface SetupOpts {
  imgLeft?: number; // untransformed position within the container
  imgTop?: number;
  paddingRight?: number; // reserved space (metadata pane) the display area excludes
}

function setup(opts: SetupOpts = {}) {
  const imgLeft = opts.imgLeft ?? 400;
  const imgTop = opts.imgTop ?? 300;
  const container = document.createElement('div');
  const img = document.createElement('img');
  container.appendChild(img);
  document.body.appendChild(container);
  if (opts.paddingRight) container.style.paddingRight = `${opts.paddingRight}px`;

  container.getBoundingClientRect = vi.fn(() => ({
    ...CONTAINER,
    right: 1000,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON() {},
  })) as never;

  // transform-origin is '0 0', so scale never moves the left/top edge — only translate
  // does. Parse the exact string applyTransform() writes rather than lean on happy-dom's
  // DOMMatrix, which parses translate()/scale() notation inconsistently.
  img.getBoundingClientRect = vi.fn(() => {
    const t = img.style.transform;
    const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
    const sc = /scale\(([-\d.]+)\)/.exec(t);
    const tx = tr ? parseFloat(tr[1]) : 0;
    const ty = tr ? parseFloat(tr[2]) : 0;
    const scale = sc ? parseFloat(sc[1]) : 1;
    const left = imgLeft + tx;
    const top = imgTop + ty;
    return {
      left,
      top,
      width: IMG_W * scale,
      height: IMG_H * scale,
      right: left + IMG_W * scale,
      bottom: top + IMG_H * scale,
      x: left,
      y: top,
      toJSON() {},
    };
  }) as never;

  const zoom = createImageZoomPan(img, container);
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
  function btn(zoom: ReturnType<typeof createImageZoomPan>, title: string): HTMLButtonElement {
    return zoom.controls.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
  }

  // Container 1000×800 with a 340px right pane reserved, so the display area is x:[0,660];
  // its centre is (330, 400). The image spans [250,450]×[320,520], covering that centre.
  const CENTRE = { x: 330, y: 400 };
  const opts = { paddingRight: 340, imgLeft: 250, imgTop: 320 };

  it('zoom-in button holds the display-area centre fixed', () => {
    const { zoom, img } = setup(opts);
    const before = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);

    btn(zoom, 'Zoom in').click();

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

    btn(zoom, 'Zoom out').click();

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

    for (let i = 0; i < 4; i++) btn(zoom, 'Zoom in').click();
    for (let i = 0; i < 6; i++) btn(zoom, 'Zoom out').click();

    const after = localUnder(img, zoom.getState().scale, CENTRE.x, CENTRE.y);
    expect(after.lx).toBeCloseTo(before.lx, 5);
    expect(after.ly).toBeCloseTo(before.ly, 5);
    zoom.destroy();
  });

  it('with no reserved pane the anchor is the full container centre', () => {
    // default layout: container centre (500, 400), image [400,600]×[300,500] covers it.
    const { zoom, img } = setup();
    const before = localUnder(img, zoom.getState().scale, 500, 400);

    btn(zoom, 'Zoom in').click();

    const after = localUnder(img, zoom.getState().scale, 500, 400);
    expect(after.lx).toBeCloseTo(before.lx, 6);
    expect(after.ly).toBeCloseTo(before.ly, 6);
    zoom.destroy();
  });
});
