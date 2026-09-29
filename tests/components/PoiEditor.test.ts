import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PoiEditor from '../../src/components/modals/PoiEditor.vue';
import type { ManualPlacement, Photo, PointOfInterest } from '../../src/types';

vi.mock('../../src/ui', () => ({
  triggerAsteroidModal: vi.fn(),
  triggerSupernovaModal: vi.fn(),
  triggerCometModal: vi.fn(),
}));
import { triggerAsteroidModal, triggerSupernovaModal, triggerCometModal } from '../../src/ui';
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

describe('PoiEditor blur-to-register', () => {
  let wrapper: ReturnType<typeof makeWrapper>;

  beforeEach(() => {
    wrapper = makeWrapper();
  });

  function lastEmittedPois(): PointOfInterest[] | undefined {
    const ev = wrapper.emitted('update:pois');
    return ev ? (ev[ev.length - 1][0] as PointOfInterest[]) : undefined;
  }

  it('registers the chip when the name input blurs to somewhere other than the dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: null });

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-a' }]);
  });

  it('does NOT register when the name input blurs to the type dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });

    expect(wrapper.emitted('update:pois')).toBeUndefined();
  });

  it('registers after the type is chosen in the dropdown', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });

    // Pick a different type — the change commits the pending name.
    await select.setValue('cat-b');

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-b' }]);
  });

  it('registers when the dropdown is left unchanged (blur to elsewhere)', async () => {
    const input = wrapper.find('input[type="text"]');
    const select = wrapper.find('select');
    await input.setValue('My Target');
    await input.trigger('blur', { relatedTarget: select.element });
    // No change event; user clicks away from the dropdown.
    await select.trigger('blur', { relatedTarget: null });

    expect(lastEmittedPois()).toEqual([{ name: 'My Target', categoryId: 'cat-a' }]);
  });

  it('does not register an empty name on blur', async () => {
    const input = wrapper.find('input[type="text"]');
    await input.trigger('blur', { relatedTarget: null });

    expect(wrapper.emitted('update:pois')).toBeUndefined();
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
