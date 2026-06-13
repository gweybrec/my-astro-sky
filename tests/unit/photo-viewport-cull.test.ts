import { describe, it, expect } from 'vitest';
import { PhotoOverlay } from '../../src/photo-overlay';

// Minimal Photo with no correspondences (applyTransform exits early — no side-effects
// beyond what updateTransforms itself does, which is exactly what we want to test).
function makePhoto(id: string) {
  return {
    id,
    filename: `${id}.jpg`,
    originalName: `photo-${id}`,
    width: 800,
    height: 600,
    correspondences: [],
    labels: [],
  } as any;
}

// A 1400×900 canvas looking straight at the NCP (projection center = 0,0).
// toCanvas(px, py, VIEW) = { x: 700 + px*500, y: 450 - py*500 }
const BASE_VIEW = {
  centerX: 0,
  centerY: 0,
  scale: 500,
  rotationDeg: 0,
  width: 1400,
  height: 900,
};

function makeOverlay(getView: () => any) {
  return new PhotoOverlay(document.createElement('div'), getView);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PhotoOverlay viewport culling — updateTransforms()', () => {
  it('does not cull when projCentroid has not been computed yet (null)', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('a')]);
    const [placed] = overlay.getPlacedPhotos();

    expect(placed.projCentroid).toBeNull();
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(false);
    expect(placed.imgEl.style.display).not.toBe('none');
  });

  it('does not cull a photo whose centroid projects to the canvas centre', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('b')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasX = 700 + 0*500 = 700, canvasY = 450 — dead centre
    placed.projCentroid = { x: 0, y: 0 };
    placed.projHalfDiag = 0.1;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(false);
    expect(placed.imgEl.style.display).not.toBe('none');
  });

  it('culls a photo whose centroid is far off-screen to the right', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('c')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasX = 700 + 5*500 = 3200; margin = 0.1*500*2 = 100; 3200-100=3100 > 1400 → cull
    placed.projCentroid = { x: 5, y: 0 };
    placed.projHalfDiag = 0.1;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(true);
    expect(placed.imgEl.style.display).toBe('none');
  });

  it('culls a photo whose centroid is far off-screen to the left', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('d')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasX = 700 - 5*500 = -1800; margin=100; -1800+100=-1700 < 0 → cull
    placed.projCentroid = { x: -5, y: 0 };
    placed.projHalfDiag = 0.1;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(true);
    expect(placed.imgEl.style.display).toBe('none');
  });

  it('culls a photo whose centroid is far above the canvas', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('e')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasY = 450 - 5*500 = -2050; margin=100; -2050+100=-1950 < 0 → cull
    placed.projCentroid = { x: 0, y: 5 };
    placed.projHalfDiag = 0.1;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(true);
    expect(placed.imgEl.style.display).toBe('none');
  });

  it('culls a photo whose centroid is far below the canvas', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('f')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasY = 450 + 5*500 = 3000 (py negative → y increases); margin=100; 3000-100=2900 > 900 → cull
    placed.projCentroid = { x: 0, y: -5 };
    placed.projHalfDiag = 0.1;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(true);
    expect(placed.imgEl.style.display).toBe('none');
  });

  it('does NOT cull when projHalfDiag is large enough to reach the screen', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('g')]);
    const [placed] = overlay.getPlacedPhotos();

    // canvasX = 700 + 1.5*500 = 1450 (just off right edge)
    // margin = 0.5*500*2 = 500; cull condition: 1450 - 500 = 950 > 1400? No → NOT culled
    placed.projCentroid = { x: 1.5, y: 0 };
    placed.projHalfDiag = 0.5;
    overlay.updateTransforms();

    expect(placed.viewportCulled).toBe(false);
  });

  it('un-culls when the view pans to bring the photo back on screen', () => {
    let view = { ...BASE_VIEW };
    const overlay = makeOverlay(() => view);
    overlay.loadPhotos([makePhoto('h')]);
    const [placed] = overlay.getPlacedPhotos();

    placed.projCentroid = { x: 5, y: 0 };
    placed.projHalfDiag = 0.1;

    // First pass: centroid is off-screen → culled
    overlay.updateTransforms();
    expect(placed.viewportCulled).toBe(true);

    // Pan view so that projection centroid x=5 is now near canvas centre
    view = { ...BASE_VIEW, centerX: 5 };
    overlay.updateTransforms();
    expect(placed.viewportCulled).toBe(false);
  });

  it('hidden (visible=false) photos are never processed by the cull check', () => {
    const overlay = makeOverlay(() => BASE_VIEW);
    overlay.loadPhotos([makePhoto('i')]);
    const [placed] = overlay.getPlacedPhotos();

    placed.projCentroid = { x: 0, y: 0 };
    placed.projHalfDiag = 0.1;
    placed.visible = false;

    overlay.updateTransforms();

    // The loop skips non-visible photos entirely — viewportCulled stays at its initial value
    expect(placed.viewportCulled).toBe(false);
  });
});
