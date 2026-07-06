import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhotoOverlay } from '../../src/photo-overlay';
import { setHemisphere, setProjectionMode, setCenterMode } from '../../src/projection';

// Minimal Photo shape for the tests
function makePhoto(id: string, labels: string[] | undefined) {
  return {
    id,
    filename: `${id}.jpg`,
    originalName: `photo-${id}`,
    width: 100,
    height: 100,
    correspondences: [],
    labels,
  } as any;
}

// Photo with manual placement so applyTransform() actually runs (and would
// otherwise force display:'block') during updateTransforms().
function makePlacedPhoto(id: string, labels: string[] | undefined) {
  return {
    ...makePhoto(id, labels),
    manualPlacement: {
      centerRa: 0,
      centerDec: 60,
      rotationDeg: 0,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    },
  } as any;
}

const VIEW = {
  centerX: 0,
  centerY: 0,
  scale: 500,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

describe('PhotoOverlay label filtering', () => {
  let container: HTMLDivElement;
  let overlay: PhotoOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    // getView stub not used by visibility logic
    overlay = new PhotoOverlay(container, () => ({}) as any);
  });

  it('shows all photos when no visibleLabels filters are set', () => {
    const p1 = makePhoto('1', ['A']);
    const p2 = makePhoto('2', []);
    overlay.loadPhotos([p1, p2]);

    // initial: no filters => all visible
    overlay.setVisibleLabels({});
    const placed = overlay.getPlacedPhotos();
    expect(placed.length).toBe(2);
    expect(placed[0].imgEl.style.display === 'block' || placed[0].imgEl.style.display === '').toBe(
      true,
    );
    expect(placed[1].imgEl.style.display === 'block' || placed[1].imgEl.style.display === '').toBe(
      true,
    );
  });

  it('hides photos whose labels are turned off', () => {
    const p1 = makePhoto('1', ['A']);
    const p2 = makePhoto('2', ['B']);
    overlay.loadPhotos([p1, p2]);

    overlay.setVisibleLabels({ A: true, B: false });
    const placed = overlay.getPlacedPhotos();
    const a = placed.find((p) => p.photo.id === '1')!;
    const b = placed.find((p) => p.photo.id === '2')!;
    expect(a.imgEl.style.display === 'block' || a.imgEl.style.display === '').toBe(true);
    expect(b.imgEl.style.display).toBe('none');
  });

  it('keeps label-hidden photos hidden after a pan/zoom (updateTransforms)', () => {
    // Regression: previously applyTransform() unconditionally set display:'block',
    // so hidden labels reappeared as soon as the user panned or zoomed.
    container = document.createElement('div');
    overlay = new PhotoOverlay(container, () => VIEW as any);

    const a = makePlacedPhoto('1', ['A']);
    const b = makePlacedPhoto('2', ['B']);
    overlay.loadPhotos([a, b]);

    overlay.setVisibleLabels({ A: true, B: false });

    // Simulate a pan/zoom which recomputes every photo's transform.
    overlay.updateTransforms();

    const placed = overlay.getPlacedPhotos();
    const pa = placed.find((p) => p.photo.id === '1')!;
    const pb = placed.find((p) => p.photo.id === '2')!;
    expect(pa.imgEl.style.display).toBe('block');
    expect(pb.imgEl.style.display).toBe('none');
  });

  // Photo with manual placement at an explicit sky position (helper above pins
  // centerDec to 60; here we need to choose the dec per-test).
  function makePlacedPhotoAt(id: string, centerRa: number, centerDec: number) {
    return {
      ...makePhoto(id, undefined),
      manualPlacement: {
        centerRa,
        centerDec,
        rotationDeg: 0,
        projPerPx: 0.002,
        mirrorX: false,
        mirrorY: false,
      },
    } as any;
  }

  describe('projection-change cull invalidation', () => {
    // The viewport-cull fast path in updateTransforms() caches each photo's
    // projection-space centroid. A hemisphere/mode/center change remaps every
    // RA/Dec to a *different* projection-space point, so the cached centroid is
    // stale afterwards. Regression: the cull used the stale centroid and, because
    // a culled photo skips applyTransform(), a photo that becomes on-screen in the
    // new projection stayed hidden forever (until its visibility was toggled).
    afterEach(() => {
      // Restore the module-global projection state for any later test.
      setCenterMode('pole');
      setProjectionMode('stereo');
      setHemisphere('north');
    });

    it('re-shows a photo that moves on-screen after a hemisphere switch', () => {
      setCenterMode('pole');
      setProjectionMode('stereo');
      setHemisphere('south');

      const container = document.createElement('div');
      const overlay = new PhotoOverlay(container, () => VIEW as any);

      // dec=+80: stereo-SOUTH r = tan(85°) ≈ 11.4 → far off-screen (culled);
      //          stereo-NORTH r = tan(5°) ≈ 0.09 → near centre (on-screen).
      const p = makePlacedPhotoAt('1', 0, 80);
      overlay.loadPhotos([p]);
      const placed = overlay.getPlacedPhotos()[0];

      // First pass sets the centroid; second pass applies the viewport cull.
      overlay.updateTransforms();
      overlay.updateTransforms();
      expect(placed.imgEl.style.display).toBe('none'); // genuinely off-screen in south

      // Switch hemisphere → the photo is now on-screen; it must reappear.
      setHemisphere('north');
      overlay.updateTransforms();
      expect(placed.imgEl.style.display).toBe('block');
    });
  });

  it('respects the (no label) special key for unlabeled photos', () => {
    const p1 = makePhoto('1', undefined);
    const p2 = makePhoto('2', ['X']);
    overlay.loadPhotos([p1, p2]);

    overlay.setVisibleLabels({ '(no label)': false, X: true });
    const placed = overlay.getPlacedPhotos();
    const unl = placed.find((p) => p.photo.id === '1')!;
    const x = placed.find((p) => p.photo.id === '2')!;
    expect(unl.imgEl.style.display).toBe('none');
    expect(x.imgEl.style.display === 'block' || x.imgEl.style.display === '').toBe(true);
  });
});
