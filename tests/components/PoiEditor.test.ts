import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PoiEditor from '../../src/components/modals/PoiEditor.vue';
import type { ManualPlacement, Photo, PointOfInterest } from '../../src/types';

vi.mock('../../src/ui', () => ({
  triggerAsteroidModal: vi.fn(),
  triggerSupernovaModal: vi.fn(),
  triggerCometModal: vi.fn(),
  triggerPoiAddModal: vi.fn(),
}));
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
import { showToast } from '../../src/toast';
const mockShowToast = vi.mocked(showToast);
import {
  triggerAsteroidModal,
  triggerSupernovaModal,
  triggerCometModal,
  triggerPoiAddModal,
} from '../../src/ui';
const mockPoiAddTrigger = vi.mocked(triggerPoiAddModal);
const mockTrigger = vi.mocked(triggerAsteroidModal);
const mockSupernovaTrigger = vi.mocked(triggerSupernovaModal);
const mockCometTrigger = vi.mocked(triggerCometModal);

const categories = [
  { id: 'cat-a', name: 'Galaxy', color: '#f00', position: 0 },
  { id: 'cat-b', name: 'Nebula', color: '#0f0', position: 1 },
];

const placement: ManualPlacement = {
  centerRa: 0,
  centerDec: 90,
  rotationDeg: 0,
  projPerPx: 0.002,
  mirrorX: false,
  mirrorY: false,
};

function makeSolvedPhoto(overrides?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1.jpg',
    width: 800,
    height: 600,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: [],
    manualPlacement: placement,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

function makeWrapper(pois: PointOfInterest[] = [], photo?: Photo | null) {
  return mount(PoiEditor, {
    props: { pois, photo },
    global: {
      plugins: [
        createTestingPinia({
          stubActions: true,
          createSpy: vi.fn,
          initialState: { poiCategories: { categories, loaded: true } },
        }),
      ],
    },
  });
}

// Test environment default language is English (see asteroid-identify.test.ts).
function findAsteroidButton(wrapper: ReturnType<typeof makeWrapper>) {
  return wrapper.findAll('button').find((b) => b.text() === 'Identify asteroid');
}

describe('PoiEditor "+ Add point of interest" trigger', () => {
  const findAddButton = (wrapper: ReturnType<typeof makeWrapper>) =>
    wrapper.findAll('button').find((b) => b.text() === '+ Add point of interest');

  beforeEach(() => {
    mockPoiAddTrigger.mockReset();
    mockShowToast.mockReset();
  });

  it('has no inline name input or type dropdown any more', () => {
    const wrapper = makeWrapper([], makeSolvedPhoto());
    expect(wrapper.find('input[type="text"]').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);
    wrapper.unmount();
  });

  it('is disabled without a photo or while the photo is unsolved', () => {
    const none = makeWrapper([], null);
    expect(findAddButton(none)!.attributes('disabled')).toBeDefined();
    none.unmount();
    const unsolved = makeWrapper([], makeSolvedPhoto({ manualPlacement: undefined }));
    expect(findAddButton(unsolved)!.attributes('disabled')).toBeDefined();
    unsolved.unmount();
  });

  it('explains why it is disabled in a tooltip, and drops the tooltip once solved', () => {
    const unsolved = makeWrapper([], makeSolvedPhoto({ manualPlacement: undefined }));
    expect(findAddButton(unsolved)!.attributes('title')).toBe(
      'Place the photo on the sky map first to add a point of interest',
    );
    unsolved.unmount();
    const solved = makeWrapper([], makeSolvedPhoto());
    expect(findAddButton(solved)!.attributes('disabled')).toBeUndefined();
    expect(findAddButton(solved)!.attributes('title')).toBeUndefined();
    solved.unmount();
  });

  it('adds a POI whose name is already used by another type', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [{ name: 'Foo', categoryId: 'cat-a' }];
    const wrapper = makeWrapper(existing, photo);
    await findAddButton(wrapper)!.trigger('click');

    const sameNameOtherType = { name: 'Foo', categoryId: 'cat-b', ra: 10, dec: 20 };
    mockPoiAddTrigger.mock.calls[0][1](photo, [sameNameOtherType]);
    expect(wrapper.emitted('update:pois')![0][0]).toEqual([...existing, sameNameOtherType]);
    wrapper.unmount();
  });

  it('says so instead of closing silently when the POI is already listed', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [{ name: 'Foo', categoryId: 'cat-a' }];
    const wrapper = makeWrapper(existing, photo);
    await findAddButton(wrapper)!.trigger('click');

    mockPoiAddTrigger.mock.calls[0][1](photo, [
      { name: 'Foo', categoryId: 'cat-a', ra: 1, dec: 2 },
    ]);
    expect(wrapper.emitted('update:pois')).toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Already in the points of interest', type: 'info' }),
    );
    wrapper.unmount();
  });

  it('opens the modal with the photo and appends the placed POI, skipping duplicates', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [{ name: 'Existing', categoryId: 'cat-a' }];
    const wrapper = makeWrapper(existing, photo);
    await findAddButton(wrapper)!.trigger('click');
    expect(mockPoiAddTrigger.mock.calls[0][0]).toEqual(photo);

    const placed = { name: 'My Target', categoryId: 'cat-b', ra: 10, dec: 20 };
    mockPoiAddTrigger.mock.calls[0][1](photo, [existing[0], placed]);
    expect(wrapper.emitted('update:pois')![0][0]).toEqual([...existing, placed]);
    wrapper.unmount();
  });
});

describe('PoiEditor "Identifier un astéroïde" trigger', () => {
  beforeEach(() => {
    mockTrigger.mockReset();
  });

  it('hides the button when no photo is given (e.g. a BatchUploadModal card before placement)', () => {
    const wrapper = makeWrapper([], null);
    expect(findAsteroidButton(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  it('hides the button when the photo is not yet solved', () => {
    const wrapper = makeWrapper([], makeSolvedPhoto({ manualPlacement: undefined }));
    expect(findAsteroidButton(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  it('shows the button and opens the modal with the photo once solved', async () => {
    const photo = makeSolvedPhoto();
    const wrapper = makeWrapper([], photo);
    const btn = findAsteroidButton(wrapper);
    expect(btn).toBeTruthy();

    await btn!.trigger('click');
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(mockTrigger.mock.calls[0][0]).toEqual(photo);
    wrapper.unmount();
  });

  it("appends the modal's results to the POI list via the callback, without persisting itself", async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [
      { name: 'Existing', categoryId: 'cat-a' },
      { name: '(4) Vesta', categoryId: 'cat-asteroid', ra: 186.9, dec: 12.8 },
    ];
    const wrapper = makeWrapper(existing, photo);
    const btn = findAsteroidButton(wrapper);
    await btn!.trigger('click');

    // Simulate the modal resolving: invoke the callback triggerAsteroidModal was given.
    // An asteroid already on the photo (same name) is skipped, not duplicated.
    const onIdentified = mockTrigger.mock.calls[0][1];
    const jz73 = { name: '(18799) 1999 JZ73', categoryId: 'cat-asteroid', ra: 186.97, dec: 12.89 };
    onIdentified(photo, [existing[1], jz73]);

    const emitted = wrapper.emitted('update:pois');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual([...existing, jz73]);
    wrapper.unmount();
  });
});

describe('PoiEditor "Identify supernovae" trigger', () => {
  const findButton = (wrapper: ReturnType<typeof makeWrapper>) =>
    wrapper.findAll('button').find((b) => b.text() === 'Identify supernovae');

  beforeEach(() => {
    mockSupernovaTrigger.mockReset();
  });

  it('only shows the button for a solved photo', () => {
    const none = makeWrapper([], null);
    expect(findButton(none)).toBeUndefined();
    none.unmount();
    const unsolved = makeWrapper([], makeSolvedPhoto({ manualPlacement: undefined }));
    expect(findButton(unsolved)).toBeUndefined();
    unsolved.unmount();
  });

  it('appends the chosen supernovae (with position), skipping ones already listed', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [
      { name: 'SN 2025rbs', categoryId: 'cat-supernova', ra: 339.265, dec: 34.419 },
    ];
    const wrapper = makeWrapper(existing, photo);
    await findButton(wrapper)!.trigger('click');
    expect(mockSupernovaTrigger.mock.calls[0][0]).toEqual(photo);

    const onIdentified = mockSupernovaTrigger.mock.calls[0][1];
    const aaiv = { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.273, dec: 34.41 };
    onIdentified(photo, [existing[0], aaiv]);

    expect(wrapper.emitted('update:pois')![0][0]).toEqual([...existing, aaiv]);
    wrapper.unmount();
  });

  it('emits nothing when every chosen supernova is already listed', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [{ name: 'SN 2026aaiv', categoryId: 'cat-supernova' }];
    const wrapper = makeWrapper(existing, photo);
    await findButton(wrapper)!.trigger('click');
    mockSupernovaTrigger.mock.calls[0][1](photo, [existing[0]]);
    expect(wrapper.emitted('update:pois')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('PoiEditor "Identify comets" trigger', () => {
  const findButton = (wrapper: ReturnType<typeof makeWrapper>) =>
    wrapper.findAll('button').find((b) => b.text() === 'Identify comets');

  beforeEach(() => {
    mockCometTrigger.mockReset();
  });

  it('only shows the button for a solved photo', () => {
    const none = makeWrapper([], null);
    expect(findButton(none)).toBeUndefined();
    none.unmount();
    const unsolved = makeWrapper([], makeSolvedPhoto({ manualPlacement: undefined }));
    expect(findButton(unsolved)).toBeUndefined();
    unsolved.unmount();
  });

  it('appends the chosen comets (with position), skipping ones already listed', async () => {
    const photo = makeSolvedPhoto();
    const existing: PointOfInterest[] = [{ name: '10P/Tempel', categoryId: 'cat-comet' }];
    const wrapper = makeWrapper(existing, photo);
    await findButton(wrapper)!.trigger('click');
    expect(mockCometTrigger.mock.calls[0][0]).toEqual(photo);

    const r2 = { name: 'C/2025 R2 (SWAN)', categoryId: 'cat-comet', ra: 341.43, dec: 2.28 };
    mockCometTrigger.mock.calls[0][1](photo, [existing[0], r2]);
    expect(wrapper.emitted('update:pois')![0][0]).toEqual([...existing, r2]);
    wrapper.unmount();
  });
});
