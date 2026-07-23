import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import BatchPhotoEditModal from '../../src/components/modals/BatchPhotoEditModal.vue';
import type { Photo } from '../../src/types';

// ─── Shared mutable state for the mocks ───────────────────────────────────────
const state = vi.hoisted(() => ({
  photos: [] as any[],
  discardUnsaved: true,
}));

const updatePhotoMetadata = vi.hoisted(() => vi.fn(async () => {}));
const getGearSetups = vi.hoisted(() =>
  vi.fn(async () => [
    { id: 'setup-a', name: 'Newton 200' },
    { id: 'setup-b', name: 'Seestar S50' },
  ]),
);
const updatePhotosData = vi.hoisted(() => vi.fn());
const syncFromOverlay = vi.hoisted(() => vi.fn());
const setGearSetups = vi.hoisted(() => vi.fn());
const confirmUnsavedChanges = vi.hoisted(() => vi.fn(async () => state.discardUnsaved));

vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'en',
  setLang: vi.fn(),
}));
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));
vi.mock('../../src/tooltip-utils', () => ({ showTextTooltip: vi.fn() }));
vi.mock('../../src/photo-delete-confirm', () => ({
  confirmUnsavedChanges: () => confirmUnsavedChanges(),
}));
vi.mock('../../src/api', () => ({
  getGearSetups: () => getGearSetups(),
  updatePhotoMetadata: (...args: unknown[]) => updatePhotoMetadata(...(args as [])),
}));
vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({
    overlay: { getPlacedPhotos: () => state.photos.map((photo) => ({ photo })), updatePhotosData },
    gallery: { setGearSetups },
  }),
}));
vi.mock('../../src/stores/photos', () => ({ usePhotosStore: () => ({ syncFromOverlay }) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
// The modal teleports to <body>, so everything is queried from the document.
function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M31.jpg',
    width: 100,
    height: 100,
    createdAt: '2024-01-01T00:00:00.000Z',
    correspondences: [],
    dsoIds: ['M31'],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    gearSetupId: null,
    ...overrides,
  } as Photo;
}

let wrapper: VueWrapper | null = null;

async function mountModal(mode: 'label' | 'setup') {
  wrapper = mount(BatchPhotoEditModal, { props: { mode } });
  await flushPromises();
  return wrapper;
}

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.body.querySelector<T>(sel);
  if (!el) throw new Error(`No element for selector: ${sel}`);
  return el;
}

function qAll<T extends Element = HTMLElement>(sel: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(sel));
}

/**
 * The list is one grid for the whole table (so `max-content` can size the name
 * column), so a "row" is a triplet of sibling cells rather than a wrapper element.
 */
function photoRows(): HTMLElement[] {
  return qAll('.batch-row-name');
}

function rowCheckbox(idx: number): HTMLInputElement {
  return qAll<HTMLInputElement>('.batch-row-check')[idx];
}

function rowSelect(idx: number): HTMLSelectElement {
  return qAll('.batch-row-widget')[idx].querySelector('select')!;
}

async function setChecked(el: HTMLInputElement, checked: boolean) {
  el.checked = checked;
  el.dispatchEvent(new Event('change'));
  await nextTick();
}

async function setSelect(el: HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('change'));
  await nextTick();
}

async function setText(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input'));
  await nextTick();
}

async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
}

beforeEach(() => {
  state.photos = [
    makePhoto({ id: 'p1', originalName: 'M31.jpg', labels: ['winter'] }),
    makePhoto({ id: 'p2', originalName: 'NGC7000.jpg', labels: [] }),
  ];
  state.discardUnsaved = true;
  updatePhotoMetadata.mockClear();
  updatePhotosData.mockClear();
  syncFromOverlay.mockClear();
  setGearSetups.mockClear();
  confirmUnsavedChanges.mockClear();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('BatchPhotoEditModal — list', () => {
  it('renders one row per photo, ignoring gallery filters', async () => {
    await mountModal('label');
    expect(photoRows()).toHaveLength(2);
    expect(document.body.textContent).toContain('M31.jpg');
    expect(document.body.textContent).toContain('NGC7000.jpg');
  });

  it('filters rows with the search box', async () => {
    await mountModal('label');
    await setText(q<HTMLInputElement>('.batch-labels-bar input.dialog-input'), 'ngc');
    expect(photoRows()).toHaveLength(1);
    expect(photoRows()[0].textContent).toContain('NGC7000.jpg');
  });

  it('select-all checks every visible row', async () => {
    await mountModal('label');
    await setChecked(q<HTMLInputElement>('.modal-form-body--scroll input[type="checkbox"]'), true);
    expect(rowCheckbox(0).checked).toBe(true);
    expect(rowCheckbox(1).checked).toBe(true);
  });

  it('loads gear setups and shares them with the gallery', async () => {
    await mountModal('setup');
    expect(setGearSetups).toHaveBeenCalledWith([
      { id: 'setup-a', name: 'Newton 200' },
      { id: 'setup-b', name: 'Seestar S50' },
    ]);
  });
});

describe('BatchPhotoEditModal — saving', () => {
  it('keeps Save disabled until something changes', async () => {
    await mountModal('setup');
    expect(q<HTMLButtonElement>('.modal-footer .btn-confirm').disabled).toBe(true);

    await setChecked(rowCheckbox(0), true);
    await setSelect(q<HTMLSelectElement>('.batch-labels-bar select'), 'setup-a');
    expect(q<HTMLButtonElement>('.modal-footer .btn-confirm').disabled).toBe(false);
  });

  it('writes only the checked photos and carries the other metadata through', async () => {
    await mountModal('setup');
    await setChecked(rowCheckbox(1), true);
    await setSelect(q<HTMLSelectElement>('.batch-labels-bar select'), 'setup-b');
    await click(q('.modal-footer .btn-confirm'));

    expect(updatePhotoMetadata).toHaveBeenCalledTimes(1);
    const [photoId, payload] = updatePhotoMetadata.mock.calls[0] as unknown as [string, any];
    expect(photoId).toBe('p2');
    expect(payload.gearSetupId).toBe('setup-b');
    expect(payload.dsoIds).toEqual(['M31']);
    expect(payload.originalName).toBe('NGC7000.jpg');
  });

  it('saves an individual row edit even when its box is unchecked', async () => {
    await mountModal('setup');
    await setSelect(rowSelect(0), 'setup-a');
    await click(q('.modal-footer .btn-confirm'));

    expect(updatePhotoMetadata).toHaveBeenCalledTimes(1);
    const [photoId, payload] = updatePhotoMetadata.mock.calls[0] as unknown as [string, any];
    expect(photoId).toBe('p1');
    expect(payload.gearSetupId).toBe('setup-a');
  });

  it('pushes the whole batch to the overlay in a single call, then closes', async () => {
    await mountModal('setup');
    await setChecked(rowCheckbox(0), true);
    await setChecked(rowCheckbox(1), true);
    await setSelect(q<HTMLSelectElement>('.batch-labels-bar select'), 'setup-a');
    await click(q('.modal-footer .btn-confirm'));

    expect(updatePhotoMetadata).toHaveBeenCalledTimes(2);
    expect(updatePhotosData).toHaveBeenCalledTimes(1);
    expect((updatePhotosData.mock.calls[0][0] as Photo[]).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(syncFromOverlay).toHaveBeenCalled();
    expect(wrapper!.emitted('saved')).toHaveLength(1);
    expect(wrapper!.emitted('close')).toHaveLength(1);
  });

  it('merges the sub-header labels into checked photos without dropping existing ones', async () => {
    await mountModal('label');
    await setChecked(rowCheckbox(0), true);
    const subHeaderInput = q<HTMLInputElement>('.batch-labels-bar .tag-input');
    await setText(subHeaderInput, 'bortle4');
    subHeaderInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    await click(q('.modal-footer .btn-confirm'));

    expect(updatePhotoMetadata).toHaveBeenCalledTimes(1);
    const [photoId, payload] = updatePhotoMetadata.mock.calls[0] as unknown as [string, any];
    expect(photoId).toBe('p1');
    expect(payload.labels).toEqual(['winter', 'bortle4']);
  });
});

describe('BatchPhotoEditModal — unsaved changes guard', () => {
  it('closes straight away when nothing is dirty', async () => {
    await mountModal('setup');
    await click(q('.modal-close'));
    expect(confirmUnsavedChanges).not.toHaveBeenCalled();
    expect(wrapper!.emitted('close')).toHaveLength(1);
  });

  it('asks before discarding a pending edit, and stays open when declined', async () => {
    state.discardUnsaved = false;
    await mountModal('setup');
    await setSelect(rowSelect(0), 'setup-a');
    await click(q('.modal-close'));

    expect(confirmUnsavedChanges).toHaveBeenCalled();
    expect(wrapper!.emitted('close')).toBeUndefined();
  });
});
