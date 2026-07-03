import { describe, it, expect, beforeEach } from 'vitest';
import { PhotoOverlay } from '../../src/photo-overlay';

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
