import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../src/types';

const mockBuildMetadataEditorPanel = vi.fn();

vi.mock('../../src/metadata-editor', () => ({
  buildMetadataEditorPanel: (...args: any[]) => mockBuildMetadataEditorPanel(...args),
}));

vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
}));

import { Gallery } from '../../src/gallery';

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M42',
    width: 1000,
    height: 700,
    createdAt: new Date().toISOString(),
    correspondences: [],
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

describe('Gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="gallery-container" style="display:none">
        <div id="gallery-hero"></div>
        <div id="gallery-grid"></div>
      </div>
    `;

    mockBuildMetadataEditorPanel.mockImplementation(
      (container: HTMLElement, photo: Photo, onSave: (p: Photo) => void) => {
        const btn = document.createElement('button');
        btn.className = 'mock-metadata-save';
        btn.textContent = 'save-meta';
        btn.addEventListener('click', () => onSave({ ...photo, notes: 'updated via metadata' }));
        container.appendChild(btn);
        return { teardown: vi.fn() };
      },
    );
  });

  it('show/hide toggles container visibility', () => {
    const gallery = new Gallery();
    const container = document.getElementById('gallery-container')!;

    gallery.show();
    expect(container.style.display).toBe('block');

    gallery.hide();
    expect(container.style.display).toBe('none');
  });

  it('renders sorted gallery items after loadPhotos', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M100', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'M2', filename: 'b.jpg' }),
      makePhoto({ id: 'c', originalName: 'M31', filename: 'c.jpg' }),
    ]);

    const names = Array.from(document.querySelectorAll('.gallery-item-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['M2', 'M31', 'M100']);
  });

  it('shows empty state when filters produce no results', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ originalName: 'M42' })]);
    gallery.setSearchQuery('does-not-match-anything');

    expect(document.getElementById('gallery-grid')!.textContent).toContain('gallery.noMatches');
    expect(document.querySelectorAll('.gallery-item').length).toBe(0);
  });

  it('filters by search query against filename, dsoIds, labels, and notes', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({
        id: 'a',
        originalName: 'M42 Orion',
        filename: 'a.jpg',
        dsoIds: ['M42'],
        labels: ['nebula'],
        notes: 'great target',
      }),
      makePhoto({
        id: 'b',
        originalName: 'NGC7000',
        filename: 'b.jpg',
        dsoIds: ['NGC7000'],
        labels: ['widefield'],
        notes: 'summer',
      }),
    ]);

    gallery.setSearchQuery('orion');
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    gallery.setSearchQuery('ngc7000');
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    gallery.setSearchQuery('nebula');
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    gallery.setSearchQuery('summer');
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    gallery.setSearchQuery('');
    expect(document.querySelectorAll('.gallery-item').length).toBe(2);
  });

  it('filters by catalog prefixes with plain, spaced, and hyphenated forms', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'NGC 7000', filename: 'b.jpg' }),
      makePhoto({ id: 'c', originalName: 'SH2-132', filename: 'c.jpg' }),
      makePhoto({ id: 'd', originalName: 'Random Name', filename: 'd.jpg' }),
    ]);

    gallery.setDSOCatalogFilter(['M']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M42');

    gallery.setDSOCatalogFilter(['NGC']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('NGC 7000');

    gallery.setDSOCatalogFilter(['SH2']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('SH2-132');

    gallery.setDSOCatalogFilter([]);
    expect(document.querySelectorAll('.gallery-item').length).toBe(4);
  });

  it('opens and closes detail modal from gallery item click', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' })]);

    const item = document.querySelector('.gallery-item') as HTMLElement;
    item.click();

    expect(document.querySelector('.gallery-cinematic-overlay')).toBeTruthy();

    const closeBtn = document.querySelector('.gallery-detail-close') as HTMLButtonElement;
    closeBtn.click();
    expect(document.querySelector('.gallery-cinematic-overlay')).toBeNull();
  });

  it('arrow keys navigate to the next/previous photo in the gallery', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M2', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg' }),
      makePhoto({ id: 'c', originalName: 'M100', filename: 'c.jpg' }),
    ]);

    const detailName = () => document.querySelector('.gallery-detail-name')?.textContent;
    const pressArrow = (key: string) =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));

    // Open the first (smart-sorted) photo
    (document.querySelectorAll('.gallery-item')[0] as HTMLElement).click();
    expect(detailName()).toBe('M2');

    pressArrow('ArrowRight');
    expect(detailName()).toBe('M31');

    pressArrow('ArrowRight');
    expect(detailName()).toBe('M100');

    // Wraps around to the first
    pressArrow('ArrowRight');
    expect(detailName()).toBe('M2');

    // Left wraps back to the last
    pressArrow('ArrowLeft');
    expect(detailName()).toBe('M100');

    // Only one overlay exists at a time
    expect(document.querySelectorAll('.gallery-cinematic-overlay').length).toBe(1);
  });

  it('arrow keys are ignored while typing in a metadata input', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M2', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg' }),
    ]);

    (document.querySelectorAll('.gallery-item')[0] as HTMLElement).click();
    expect(document.querySelector('.gallery-detail-name')?.textContent).toBe('M2');

    const input = document.createElement('input');
    document.querySelector('.gallery-cinematic-overlay')!.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // Still on the same photo — navigation was not triggered
    expect(document.querySelector('.gallery-detail-name')?.textContent).toBe('M2');
  });

  it('show on map button calls onNavigateToMap and closes modal', async () => {
    const gallery = new Gallery();
    const photo = makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' });
    gallery.loadPhotos([photo]);

    const navSpy = vi.fn();
    gallery.onNavigateToMap = navSpy;

    (document.querySelector('.gallery-item') as HTMLElement).click();

    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'gallery.showOnMap',
    ) as HTMLButtonElement;
    button.click();
    // close() is async; flush microtasks so the handler completes
    await Promise.resolve();
    await Promise.resolve();

    expect(navSpy).toHaveBeenCalledOnce();
    expect(navSpy).toHaveBeenCalledWith(photo);
    expect(document.querySelector('.gallery-cinematic-overlay')).toBeNull();
  });

  it('delete button asks confirmation then calls onDeletePhoto', async () => {
    const gallery = new Gallery();
    const photo = makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' });
    gallery.loadPhotos([photo]);

    const delSpy = vi.fn();
    gallery.onDeletePhoto = delSpy;

    (document.querySelector('.gallery-item') as HTMLElement).click();

    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'photos.deleteThisPhoto',
    ) as HTMLButtonElement;
    button.click();

    const confirmBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'photos.deleteConfirmAction',
    ) as HTMLButtonElement;
    confirmBtn.click();

    // Wait for the async click handler to finish.
    await Promise.resolve();

    expect(delSpy).toHaveBeenCalledOnce();
    expect(delSpy).toHaveBeenCalledWith(photo);
  });

  it('metadata save callback updates photo and triggers onPhotoMetadataUpdated', () => {
    const gallery = new Gallery();
    const photo = makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg', notes: 'old' });
    gallery.loadPhotos([photo]);

    const metaSpy = vi.fn();
    gallery.onPhotoMetadataUpdated = metaSpy;

    (document.querySelector('.gallery-item') as HTMLElement).click();

    const saveBtn = document.querySelector('.mock-metadata-save') as HTMLButtonElement;
    saveBtn.click();

    expect(metaSpy).toHaveBeenCalledOnce();
    const updated = metaSpy.mock.calls[0][0] as Photo;
    expect(updated.notes).toBe('updated via metadata');
  });

  it('setLabelFilter is opt-in: null/empty shows all, non-empty narrows to matching photos', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg', labels: ['nebula'] }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg', labels: ['galaxy'] }),
      makePhoto({ id: 'c', originalName: 'NGC7000', filename: 'c.jpg', labels: [] }),
    ]);

    // Default (null) → all photos shown
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);

    // Empty array → treated as no filter → all photos shown
    gallery.setLabelFilter([]);
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);

    // Opt-in: only 'nebula' selected → only M42 shown
    gallery.setLabelFilter(['nebula']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M42');

    // Add 'galaxy' → M42 + M31 shown
    gallery.setLabelFilter(['nebula', 'galaxy']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(2);
    const visibleNames = Array.from(document.querySelectorAll('.gallery-item-name')).map(
      (n) => n.textContent,
    );
    expect(visibleNames).toContain('M42');
    expect(visibleNames).toContain('M31');

    // Also select '(no label)' → all 3 shown
    gallery.setLabelFilter(['nebula', 'galaxy', '(no label)']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);

    // Clear back to null → all photos shown
    gallery.setLabelFilter(null);
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);
  });

  it('setPoiFilter restricts to photos with a matching point of interest', () => {
    const gallery = new Gallery();
    gallery.setPoiCategories([
      { id: 'cat-comet', name: 'Comet', color: '#111', position: 0 },
      { id: 'cat-asteroid', name: 'Asteroid', color: '#222', position: 1 },
    ]);
    gallery.loadPhotos([
      makePhoto({
        id: 'a',
        originalName: 'M42',
        filename: 'a.jpg',
        pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
      }),
      makePhoto({
        id: 'b',
        originalName: 'M31',
        filename: 'b.jpg',
        pointsOfInterest: [{ name: 'Vesta', categoryId: 'cat-asteroid' }],
      }),
      makePhoto({ id: 'c', originalName: 'NGC7000', filename: 'c.jpg', pointsOfInterest: [] }),
    ]);

    // No filter → all visible.
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);

    // Filter to the whole comet category → only the comet photo.
    gallery.setPoiFilter(new Map([['cat-comet', new Set<string>()]]));
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M42');

    // Filter to a specific asteroid name → only the asteroid photo.
    gallery.setPoiFilter(new Map([['cat-asteroid', new Set(['Vesta'])]]));
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M31');

    // Empty map disables the filter → all visible again.
    gallery.setPoiFilter(new Map());
    expect(document.querySelectorAll('.gallery-item').length).toBe(3);
  });

  it('renders POI chips for a photo whose only metadata is points of interest', () => {
    const gallery = new Gallery();
    gallery.setPoiCategories([{ id: 'cat-comet', name: 'Comet', color: '#111', position: 0 }]);
    // No dsoIds, no labels — only a POI. The chip must still render.
    gallery.loadPhotos([
      makePhoto({
        id: 'a',
        originalName: 'M42',
        filename: 'a.jpg',
        dsoIds: [],
        labels: [],
        pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
      }),
    ]);

    const chips = document.querySelectorAll('.gallery-item .poi-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('C/2023 A3');
  });

  it('new labels from metadata edits do not auto-join an active filter (opt-in model)', () => {
    const gallery = new Gallery();
    const photo = makePhoto({
      id: 'a',
      originalName: 'M42',
      filename: 'a.jpg',
      labels: ['nebula'],
    });
    gallery.loadPhotos([photo]);

    // Active filter: only 'nebula' selected
    gallery.setLabelFilter(['nebula']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    // Simulate metadata save adding a brand-new label 'deepsky'
    gallery['photos'][0] = { ...photo, labels: ['nebula', 'deepsky'] };
    gallery['applyFilters']();

    // M42 still passes because 'nebula' is still in the filter
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);

    // The filter was NOT expanded to include 'deepsky' automatically
    // (a separate photo with only 'deepsky' would be hidden)
    const photo2 = makePhoto({
      id: 'b',
      originalName: 'M31',
      filename: 'b.jpg',
      labels: ['deepsky'],
    });
    gallery['photos'].push(photo2);
    gallery['applyFilters']();
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M42');
  });

  it('setDSOTypeFilter can be called without changing visible items (current implementation)', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42' }),
      makePhoto({ id: 'b', originalName: 'NGC7000' }),
    ]);

    gallery.setDSOTypeFilter(['EN']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(2);

    gallery.setDSOTypeFilter([]);
    expect(document.querySelectorAll('.gallery-item').length).toBe(2);
  });

  // ── Lazy-loading DOM structure ─────────────────────────────────────────────

  it('items are built with dataset.src but no src attribute (lazy loading)', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' })]);

    const img = document.querySelector('.gallery-item img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBeNull();
    expect(img.dataset.src).toBe('/uploads/a.jpg');
  });

  it('images start with visibility hidden until loaded', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' })]);

    const img = document.querySelector('.gallery-item img') as HTMLImageElement;
    expect(img.style.visibility).toBe('hidden');
  });

  it('uses thumbFilename for dataset.src when available', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42', thumbFilename: 'a_thumb.jpg' }),
    ]);

    const img = document.querySelector('.gallery-item img') as HTMLImageElement;
    expect(img.dataset.src).toBe('/uploads/a_thumb.jpg');
  });

  it('falls back to filename when thumbFilename is absent', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' })]);

    const img = document.querySelector('.gallery-item img') as HTMLImageElement;
    expect(img.dataset.src).toBe('/uploads/a.jpg');
  });

  it('falls back to filename when thumbFilename is null', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42', thumbFilename: null }),
    ]);

    const img = document.querySelector('.gallery-item img') as HTMLImageElement;
    expect(img.dataset.src).toBe('/uploads/a.jpg');
  });

  it('renders a loading placeholder for every item', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' }),
      makePhoto({ id: 'b', filename: 'b.jpg', originalName: 'M31' }),
    ]);

    const placeholders = document.querySelectorAll('.gallery-img-placeholder');
    expect(placeholders.length).toBe(2);
  });

  it('onload removes the placeholder and restores visibility', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' })]);

    const item = document.querySelector('.gallery-item') as HTMLElement;
    const img = item.querySelector('img') as HTMLImageElement;

    expect(item.querySelector('.gallery-img-placeholder')).toBeTruthy();
    expect(img.style.visibility).toBe('hidden');

    img.dispatchEvent(new Event('load'));

    expect(item.querySelector('.gallery-img-placeholder')).toBeNull();
    expect(img.style.visibility).toBe('');
  });

  it('placeholders are removed on re-render but prior ones do not accumulate', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' })]);

    // Simulate onload for the first render
    (document.querySelector('.gallery-item img') as HTMLImageElement).dispatchEvent(
      new Event('load'),
    );
    expect(document.querySelectorAll('.gallery-img-placeholder').length).toBe(0);

    // Re-render by applying a filter and clearing it
    gallery.setSearchQuery('M42');
    gallery.setSearchQuery('');

    // New render creates new shells — one placeholder per item, none carried over
    expect(document.querySelectorAll('.gallery-img-placeholder').length).toBe(1);
    expect((document.querySelector('.gallery-item img') as HTMLImageElement).style.visibility).toBe(
      'hidden',
    );
  });

  // ── Carousel auto-advance timer ───────────────────────────────────────────

  describe('carousel auto-advance timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const twoPhotos = () => [
      makePhoto({ id: 'a', filename: 'a.jpg', originalName: 'M42' }),
      makePhoto({ id: 'b', filename: 'b.jpg', originalName: 'M31' }),
    ];

    const counterText = () =>
      document.querySelector('.gallery-carousel-counter')?.textContent ?? '';

    it('advances carousel after 20s when gallery is shown', () => {
      const gallery = new Gallery();
      gallery.loadPhotos(twoPhotos());
      gallery.show();

      expect(counterText()).toBe('1 / 2');
      vi.advanceTimersByTime(20_000);
      expect(counterText()).toBe('2 / 2');
    });

    it('wraps back to first photo after reaching the end', () => {
      const gallery = new Gallery();
      gallery.loadPhotos(twoPhotos());
      gallery.show();

      vi.advanceTimersByTime(40_000);
      expect(counterText()).toBe('1 / 2');
    });

    it('stops advancing after hide()', () => {
      const gallery = new Gallery();
      gallery.loadPhotos(twoPhotos());
      gallery.show();
      gallery.hide();

      vi.advanceTimersByTime(40_000);
      expect(counterText()).toBe('1 / 2');
    });

    it('does not start timer for a single photo', () => {
      const gallery = new Gallery();
      gallery.loadPhotos([makePhoto()]);
      gallery.show();

      expect(document.querySelector('.gallery-carousel-counter')).toBeNull();
      vi.advanceTimersByTime(40_000);
      // No error thrown and no counter element means timer was not started
    });

    it('resets timer on manual next navigation', () => {
      const gallery = new Gallery();
      gallery.loadPhotos(twoPhotos());
      gallery.show();

      // Advance 19s then click next manually
      vi.advanceTimersByTime(19_000);
      document.querySelector<HTMLButtonElement>('.gallery-carousel-next')!.click();
      expect(counterText()).toBe('2 / 2');

      // 19s after the click — timer was reset, so should not have auto-advanced yet
      vi.advanceTimersByTime(19_000);
      expect(counterText()).toBe('2 / 2');

      // 1s more = 20s after the click — should now auto-advance and wrap
      vi.advanceTimersByTime(1_000);
      expect(counterText()).toBe('1 / 2');
    });

    it('restarts timer after renderCarousel while gallery is visible', () => {
      const gallery = new Gallery();
      gallery.loadPhotos(twoPhotos());
      gallery.show();

      // Trigger a re-render (simulates metadata save callback)
      gallery.loadPhotos(twoPhotos());

      expect(counterText()).toBe('1 / 2');
      vi.advanceTimersByTime(20_000);
      expect(counterText()).toBe('2 / 2');
    });
  });

  // ── IntersectionObserver reuse (F3) ───────────────────────────────────────

  it('IntersectionObserver is constructed once per Gallery instance, not once per render', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const Ctor = vi.fn().mockReturnValue({ observe, disconnect, unobserve: vi.fn() });
    vi.stubGlobal('IntersectionObserver', Ctor);

    const gallery = new Gallery();
    expect(Ctor).toHaveBeenCalledTimes(1);

    // Three renders triggered by filter changes
    gallery.loadPhotos([makePhoto({ id: 'a', originalName: 'M42' })]);
    gallery.setSearchQuery('M42');
    gallery.setSearchQuery('');

    // Still exactly one constructor call — same observer reused
    expect(Ctor).toHaveBeenCalledTimes(1);

    // disconnect was called on each re-render to clear old observations
    expect(disconnect.mock.calls.length).toBeGreaterThanOrEqual(3);

    vi.unstubAllGlobals();
  });
});
