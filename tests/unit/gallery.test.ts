import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../src/types';

const mockBuildMetadataEditorPanel = vi.fn();

vi.mock('../../src/metadata-editor', () => ({
  buildMetadataEditorPanel: (...args: any[]) => mockBuildMetadataEditorPanel(...args),
}));

vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'en',
  setLang: vi.fn(),
}));

vi.mock('../../src/poi-pins', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/poi-pins')>();
  return { ...real, poiPinsInImage: vi.fn(real.poiPinsInImage) };
});

import { Gallery } from '../../src/gallery';
import { poiPinsInImage } from '../../src/poi-pins';
import { setCenterMode, setProjectionObserver } from '../../src/projection';

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

  it('replaces an open detail view rather than stacking a second one', async () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg' }),
    ]);
    gallery.openPhoto('a');
    const firstTeardown = mockBuildMetadataEditorPanel.mock.results[0].value.teardown;

    gallery.openPhoto('b'); // e.g. the sky map's photo list, while "a" is still open
    await Promise.resolve();

    const overlays = document.querySelectorAll('.gallery-cinematic-overlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0].querySelector('img')?.getAttribute('alt')).toBe('M31');
    expect(firstTeardown).toHaveBeenCalledOnce();
    expect(mockBuildMetadataEditorPanel).toHaveBeenCalledTimes(2);

    // Close it: an open detail keeps a document keydown listener across tests.
    (document.querySelector('.gallery-detail-close') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector('.gallery-cinematic-overlay')).toBeNull();
  });

  it('keeps the open detail view when its unsaved edits are not discarded', async () => {
    mockBuildMetadataEditorPanel.mockImplementationOnce(() => ({
      teardown: vi.fn(),
      isDirty: () => true,
    }));
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg' }),
    ]);
    gallery.openPhoto('a');
    gallery.openPhoto('b');

    const keepEditing = Array.from(document.querySelectorAll('.dialog button')).find(
      (b) => b.textContent === 'gallery.cancelEdit',
    ) as HTMLButtonElement;
    keepEditing.click();
    await Promise.resolve();
    await Promise.resolve();

    const overlays = document.querySelectorAll('.gallery-cinematic-overlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0].querySelector('img')?.getAttribute('alt')).toBe('M42');
    expect(mockBuildMetadataEditorPanel).toHaveBeenCalledTimes(1);

    // Close it, discarding: an open detail keeps a document keydown listener across tests.
    (document.querySelector('.gallery-detail-close') as HTMLButtonElement).click();
    const discard = Array.from(document.querySelectorAll('.dialog button')).find(
      (b) => b.textContent === 'gallery.closeWithoutSaving',
    ) as HTMLButtonElement;
    discard.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.gallery-cinematic-overlay')).toBeNull();
  });

  it('pins an unsaved positioned POI on the photo as soon as the editor reports it', () => {
    const gallery = new Gallery();
    gallery.loadPhotos([
      makePhoto({
        id: 'sn',
        originalName: 'NGC7331',
        filename: 'sn.jpg',
        manualPlacement: {
          centerRa: 339.27,
          centerDec: 34.42,
          rotationDeg: 0,
          projPerPx: 0.00002,
          mirrorX: false,
          mirrorY: false,
        },
      }),
    ]);
    (document.querySelector('.gallery-item') as HTMLElement).click();

    const canvas = document.querySelector('.gallery-detail-dso-overlay') as HTMLCanvasElement;
    // Give the image and its wrapper a real layout box so the overlay can draw.
    const img = document.querySelector('.gallery-cinematic-img') as HTMLImageElement;
    const box = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0 };
    img.getBoundingClientRect = () => ({ ...box, toJSON() {} }) as DOMRect;
    img.parentElement!.getBoundingClientRect = () => ({ ...box, toJSON() {} }) as DOMRect;
    expect(canvas.style.display).toBe('none');

    // 7th argument: the editor's unsaved-POI callback (fired by "Add selected").
    const onPoisChange = mockBuildMetadataEditorPanel.mock.calls[0][6] as (
      pois: Photo['pointsOfInterest'],
    ) => void;
    onPoisChange([{ name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.27, dec: 34.42 }]);
    expect(canvas.style.display).toBe('block');

    // Removing it again (still unsaved) hides the overlay.
    onPoisChange([]);
    expect(canvas.style.display).toBe('none');
  });

  describe('detail header icon buttons', () => {
    const placement = {
      centerRa: 339.27,
      centerDec: 34.42,
      rotationDeg: 0,
      projPerPx: 0.00002,
      mirrorX: false,
      mirrorY: false,
    };
    const box = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0 };

    function openDetail(overrides: Partial<Photo>) {
      const gallery = new Gallery();
      gallery.loadPhotos([makePhoto({ id: 'd', filename: 'd.jpg', ...overrides })]);
      (document.querySelector('.gallery-item') as HTMLElement).click();
      const img = document.querySelector('.gallery-cinematic-img') as HTMLImageElement;
      img.getBoundingClientRect = () => ({ ...box, toJSON() {} }) as DOMRect;
      img.parentElement!.getBoundingClientRect = () => ({ ...box, toJSON() {} }) as DOMRect;
      const btn = (label: string) =>
        document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
      return {
        dsos: btn('gallery.showDsos'),
        pois: btn('gallery.showPois'),
        map: btn('gallery.showOnMap'),
        canvas: document.querySelector('.gallery-detail-dso-overlay') as HTMLCanvasElement,
      };
    }

    it('renders DSO, POI and map icon buttons in that order', () => {
      const { dsos, pois, map } = openDetail({ manualPlacement: placement });
      const row = [...document.querySelectorAll('.gallery-detail-btn-row button')];
      expect(row).toEqual([dsos, pois, map]);
      for (const b of row) {
        expect(b.querySelector('svg')).toBeTruthy();
        expect(b.textContent?.trim()).toBe('');
      }
    });

    it('disables the POI button with a reason when no POI has a position', () => {
      const { pois } = openDetail({
        manualPlacement: placement,
        pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
      });
      expect(pois.disabled).toBe(true);
      expect(pois.title).toBe('gallery.showPoisUnavailable');
    });

    it('POI pins are off by default and toggle on with the button', () => {
      const { pois, canvas } = openDetail({
        manualPlacement: placement,
        pointsOfInterest: [
          { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.27, dec: 34.42 },
        ],
      });
      expect(pois.disabled).toBe(false);
      expect(pois.getAttribute('aria-pressed')).toBe('false');
      expect(canvas.style.display).toBe('none');

      pois.click();
      expect(pois.getAttribute('aria-pressed')).toBe('true');
      // Pressed state is aria-pressed only — the class list never changes (no resize).
      expect(pois.className).toBe('btn-action gallery-detail-toggle-btn');
      expect(canvas.style.display).toBe('block');

      pois.click();
      expect(canvas.style.display).toBe('none');
    });

    it('switches POI pins on when a positioned POI is newly added in the editor', () => {
      const { pois, canvas } = openDetail({ manualPlacement: placement });
      expect(pois.disabled).toBe(true);
      const onPoisChange = mockBuildMetadataEditorPanel.mock.calls[0][6] as (
        p: Photo['pointsOfInterest'],
      ) => void;
      onPoisChange([{ name: 'SN X', categoryId: 'cat-supernova', ra: 339.27, dec: 34.42 }]);
      expect(pois.disabled).toBe(false);
      expect(pois.getAttribute('aria-pressed')).toBe('true');
      expect(canvas.style.display).toBe('block');
    });

    it('enables the POI button for an unsaved identified asteroid, not for a typed name', () => {
      const { pois, canvas } = openDetail({ manualPlacement: placement });
      const onPoisChange = mockBuildMetadataEditorPanel.mock.calls[0][6] as (
        p: Photo['pointsOfInterest'],
      ) => void;
      const typed = { name: 'Some satellite', categoryId: 'cat-satellite' };
      onPoisChange([typed]);
      expect(pois.disabled).toBe(true);
      expect(pois.title).toBe('gallery.showPoisUnavailable');

      onPoisChange([
        typed,
        { name: '(18799) 1999 JZ73', categoryId: 'cat-asteroid', ra: 339.27, dec: 34.42 },
      ]);
      expect(pois.disabled).toBe(false);
      expect(pois.title).toBe('gallery.showPois');
      expect(canvas.style.display).toBe('block');
    });
  });

  it('keeps pins on target when the zenith projection rotates after the view opened', () => {
    // Zenith-centred ("local sky") projection follows the sky clock: a photo→projection
    // matrix fitted when the detail view opened is stale a minute later, which put
    // pins (and DSO outlines) minutes of arc off target. Pins must use a fresh fit.
    setCenterMode('zenith');
    setProjectionObserver(22, 45);
    try {
      const gallery = new Gallery();
      gallery.loadPhotos([
        makePhoto({
          id: 'sn',
          originalName: 'NGC7331',
          filename: 'sn.jpg',
          manualPlacement: {
            centerRa: 339.27,
            centerDec: 34.42,
            rotationDeg: 0,
            projPerPx: 0.00005,
            mirrorX: false,
            mirrorY: false,
          },
        }),
      ]);
      (document.querySelector('.gallery-item') as HTMLElement).click();

      setProjectionObserver(22.5, 45); // half an hour of sidereal time later
      const onPoisChange = mockBuildMetadataEditorPanel.mock.calls[0][6] as (
        pois: Photo['pointsOfInterest'],
      ) => void;
      onPoisChange([{ name: 'SN centre', categoryId: 'cat-supernova', ra: 339.27, dec: 34.42 }]);

      const pins = vi.mocked(poiPinsInImage).mock.results.at(-1)!.value;
      expect(pins).toHaveLength(1);
      expect(pins[0].x).toBeCloseTo(500, 0);
      expect(pins[0].y).toBeCloseTo(350, 0);
    } finally {
      setCenterMode('pole');
    }
  });

  it('pins a POI while the zenith-centred sky map has the photo below the horizon', () => {
    // Zenith mode clips below-horizon points to one sentinel, which used to collapse
    // the photo's fit (no pins at all); sky math now runs in the canonical projection.
    setCenterMode('zenith');
    setProjectionObserver(10.6, 45); // RA 22h37m is ~12 h from the meridian
    try {
      const gallery = new Gallery();
      gallery.loadPhotos([
        makePhoto({
          id: 'sn',
          originalName: 'NGC7331',
          filename: 'sn.jpg',
          manualPlacement: {
            centerRa: 339.27,
            centerDec: 34.42,
            rotationDeg: 0,
            projPerPx: 0.00005,
            mirrorX: false,
            mirrorY: false,
          },
        }),
      ]);
      (document.querySelector('.gallery-item') as HTMLElement).click();
      const onPoisChange = mockBuildMetadataEditorPanel.mock.calls[0][6] as (
        pois: Photo['pointsOfInterest'],
      ) => void;
      onPoisChange([{ name: 'SN centre', categoryId: 'cat-supernova', ra: 339.27, dec: 34.42 }]);

      const pins = vi.mocked(poiPinsInImage).mock.results.at(-1)!.value;
      expect(pins).toHaveLength(1);
      expect(pins[0].x).toBeCloseTo(500, 0);
      expect(pins[0].y).toBeCloseTo(350, 0);
    } finally {
      setCenterMode('pole');
    }
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

    const button = document.querySelector(
      'button[aria-label="gallery.showOnMap"]',
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

  it('setSetupFilter / getAllSetups group photos by linked gear setup with a (no setup) sentinel', () => {
    const gallery = new Gallery();
    const setup = (id: string, name: string) => ({
      id,
      name,
      telescopeId: 't',
      cameraId: 'c',
      accessoryId: null,
      enabled: true,
    });
    gallery.setGearSetups([setup('s1', 'Vespera'), setup('s2', 'Seestar')]);
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg', gearSetupId: 's1' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg', gearSetupId: 's2' }),
      makePhoto({ id: 'c', originalName: 'NGC7000', filename: 'c.jpg', gearSetupId: null }),
      // dangling setup id (setup since deleted) is treated as "no setup"
      makePhoto({ id: 'd', originalName: 'M13', filename: 'd.jpg', gearSetupId: 'gone' }),
    ]);

    // Options sorted by name, sentinel last; dangling + null fall into (no setup)
    const setups = gallery.getAllSetups();
    expect(setups.map((s) => s.setupId)).toEqual(['s2', 's1', '(no setup)']);
    expect(setups.find((s) => s.setupId === '(no setup)')?.count).toBe(2);

    gallery.setSetupFilter(['s1']);
    expect(document.querySelectorAll('.gallery-item').length).toBe(1);
    expect(document.querySelector('.gallery-item-name')?.textContent).toBe('M42');

    gallery.setSetupFilter(['(no setup)']);
    const names = Array.from(document.querySelectorAll('.gallery-item-name'))
      .map((n) => n.textContent)
      .sort();
    expect(names).toEqual(['M13', 'NGC7000']);

    gallery.setSetupFilter(null);
    expect(document.querySelectorAll('.gallery-item').length).toBe(4);
  });

  it('renders the gear-setup name as the first (green) chip on grid cards', () => {
    const gallery = new Gallery();
    gallery.setGearSetups([
      {
        id: 's1',
        name: 'Vespera',
        telescopeId: 't',
        cameraId: 'c',
        accessoryId: null,
        enabled: true,
      },
    ]);
    gallery.loadPhotos([
      makePhoto({
        id: 'a',
        originalName: 'M42',
        filename: 'a.jpg',
        gearSetupId: 's1',
        labels: ['nebula'],
      }),
    ]);
    const chips = document.querySelector('.gallery-item-chips')!;
    const first = chips.querySelector('.tag-chip');
    expect(first?.classList.contains('setup-chip')).toBe(true);
    expect(first?.textContent).toBe('Vespera');
    // The label chip is still rendered (now styled separately)
    expect(chips.querySelector('.label-chip')?.textContent).toBe('nebula');
  });

  it('setGearSetups is a no-op when the setup list is unchanged (no hero carousel rebuild)', () => {
    const gallery = new Gallery();
    const setup = (id: string, name: string) => ({
      id,
      name,
      telescopeId: 't',
      cameraId: 'c',
      accessoryId: null,
      enabled: true,
    });
    gallery.setGearSetups([setup('s1', 'Vespera')]);
    gallery.loadPhotos([
      makePhoto({ id: 'a', originalName: 'M42', filename: 'a.jpg', gearSetupId: 's1' }),
      makePhoto({ id: 'b', originalName: 'M31', filename: 'b.jpg', gearSetupId: 's1' }),
    ]);

    const heroImgBefore = document.querySelector('.gallery-carousel-img');
    expect(heroImgBefore).not.toBeNull();

    // Re-supplying an identical setup list (e.g. re-fetched every time the setups
    // dropdown is opened) must not tear down and rebuild the hero carousel.
    gallery.setGearSetups([setup('s1', 'Vespera')]);
    expect(document.querySelector('.gallery-carousel-img')).toBe(heroImgBefore);

    // A genuine change (rename) still refreshes it.
    gallery.setGearSetups([setup('s1', 'Vespera Pro')]);
    expect(document.querySelector('.gallery-carousel-img')).not.toBe(heroImgBefore);
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

  // ── Observation-date range filter ─────────────────────────────────────────

  describe('setDateRangeFilter', () => {
    const dated = () => {
      const gallery = new Gallery();
      gallery.loadPhotos([
        makePhoto({
          id: 'a',
          originalName: 'M42',
          filename: 'a.jpg',
          observationDate: '2024-03-14T21:05:00.000Z',
        }),
        makePhoto({
          id: 'b',
          originalName: 'M31',
          filename: 'b.jpg',
          observationDate: '2024-03-18T03:30:00.000Z',
        }),
        makePhoto({
          id: 'c',
          originalName: 'M13',
          filename: 'c.jpg',
          observationDate: '2024-04-02T22:00:00.000Z',
        }),
        makePhoto({ id: 'd', originalName: 'NGC7000', filename: 'd.jpg', observationDate: null }),
      ]);
      return gallery;
    };
    const visibleNames = () =>
      Array.from(document.querySelectorAll('.gallery-item-name'))
        .map((n) => n.textContent)
        .sort();

    it('From alone matches exactly that UTC day', () => {
      const gallery = dated();
      gallery.setDateRangeFilter('2024-03-14', null);
      expect(visibleNames()).toEqual(['M42']);
    });

    it('From + To is inclusive on both ends', () => {
      const gallery = dated();
      gallery.setDateRangeFilter('2024-03-14', '2024-04-02');
      expect(visibleNames()).toEqual(['M13', 'M31', 'M42']);
    });

    it('a reversed From/To pair is swapped, not treated as empty', () => {
      const gallery = dated();
      gallery.setDateRangeFilter('2024-04-02', '2024-03-14');
      expect(visibleNames()).toEqual(['M13', 'M31', 'M42']);
    });

    it('photos with no observationDate are excluded while active and return once cleared', () => {
      const gallery = dated();
      gallery.setDateRangeFilter('2024-01-01', '2024-12-31');
      expect(visibleNames()).toEqual(['M13', 'M31', 'M42']); // NGC7000 (no date) hidden

      gallery.setDateRangeFilter(null, null);
      expect(visibleNames()).toEqual(['M13', 'M31', 'M42', 'NGC7000']);
    });

    it('an empty-string From clears the filter', () => {
      const gallery = dated();
      gallery.setDateRangeFilter('2024-03-14', null);
      expect(document.querySelectorAll('.gallery-item').length).toBe(1);

      gallery.setDateRangeFilter('', '');
      expect(document.querySelectorAll('.gallery-item').length).toBe(4);
    });
  });
});
