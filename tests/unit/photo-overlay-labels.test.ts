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

describe('PhotoOverlay label filtering', () => {
  let container: HTMLDivElement;
  let overlay: PhotoOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    // getView stub not used by visibility logic
    overlay = new PhotoOverlay(container, () => ({} as any));
  });

  it('shows all photos when no visibleLabels filters are set', () => {
    const p1 = makePhoto('1', ['A']);
    const p2 = makePhoto('2', []);
    overlay.loadPhotos([p1, p2]);

    // initial: no filters => all visible
    overlay.setVisibleLabels({});
    const placed = overlay.getPlacedPhotos();
    expect(placed.length).toBe(2);
    expect(placed[0].imgEl.style.display === 'block' || placed[0].imgEl.style.display === '').toBe(true);
    expect(placed[1].imgEl.style.display === 'block' || placed[1].imgEl.style.display === '').toBe(true);
  });

  it('hides photos whose labels are turned off', () => {
    const p1 = makePhoto('1', ['A']);
    const p2 = makePhoto('2', ['B']);
    overlay.loadPhotos([p1, p2]);

    overlay.setVisibleLabels({ 'A': true, 'B': false });
    const placed = overlay.getPlacedPhotos();
    const a = placed.find(p => p.photo.id === '1')!;
    const b = placed.find(p => p.photo.id === '2')!;
    expect(a.imgEl.style.display === 'block' || a.imgEl.style.display === '').toBe(true);
    expect(b.imgEl.style.display).toBe('none');
  });

  it('respects the (no label) special key for unlabeled photos', () => {
    const p1 = makePhoto('1', undefined);
    const p2 = makePhoto('2', ['X']);
    overlay.loadPhotos([p1, p2]);

    overlay.setVisibleLabels({ '(no label)': false, 'X': true });
    const placed = overlay.getPlacedPhotos();
    const unl = placed.find(p => p.photo.id === '1')!;
    const x = placed.find(p => p.photo.id === '2')!;
    expect(unl.imgEl.style.display).toBe('none');
    expect(x.imgEl.style.display === 'block' || x.imgEl.style.display === '').toBe(true);
  });
});
