import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ImportModal from '../../src/components/modals/ImportModal.vue';
import { showToast } from '../../src/toast';

const api = vi.hoisted(() => ({
  importPreview: vi.fn(),
  importData: vi.fn(),
  exportData: vi.fn(),
  getPhotos: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  t: (key: string) =>
    key === 'settings.importSetupWithPlan'
      ? `with plan {name}`
      : key === 'settings.importFailedItems'
        ? 'failed: {names}'
        : key,
}));
vi.mock('../../src/api', () => api);
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/dso-catalog', () => ({ reloadUserOverrides: vi.fn() }));
vi.mock('../../src/stores/photos', () => ({
  usePhotosStore: () => ({ placedPhotos: [], syncFromOverlay: vi.fn() }),
}));
vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({ overlay: null, skyMap: null, gallery: null }),
}));
vi.mock('../../src/stores/shortcuts', () => ({
  useShortcutsStore: () => ({ importJSON: vi.fn() }),
}));
vi.mock('../../src/stores/poi-categories', () => ({
  usePoiCategoriesStore: () => ({ load: vi.fn() }),
}));
vi.mock('../../src/stores/sky-regions', () => ({ useSkyRegionsStore: () => ({ load: vi.fn() }) }));

/** One plan per setup state: none, identical, different. */
const PREVIEW = {
  hasMetadata: false,
  photos: 0,
  hasDsoOverrides: false,
  hasCustomGear: false,
  hasSetups: true,
  hasPoiCategories: false,
  hasSkyRegions: false,
  hasPlans: true,
  hasShortcuts: false,
  images: [],
  plans: [
    { id: 'plan-a', name: 'Plan A', exists: false, setupId: 'setup-new' },
    { id: 'plan-b', name: 'Plan B', exists: false, setupId: 'setup-same' },
    { id: 'plan-c', name: 'Plan C', exists: false, setupId: 'setup-diff' },
  ],
  setups: [
    { id: 'setup-new', name: 'New rig', exists: false, conflict: 'none' },
    {
      id: 'setup-same',
      name: 'Same rig',
      exists: true,
      conflict: 'identical',
      localId: 'setup-same',
    },
    {
      id: 'setup-diff',
      name: 'Diff rig',
      exists: true,
      conflict: 'different',
      localId: 'local-diff',
    },
  ],
  gear: [],
};

async function openDialog(): Promise<VueWrapper> {
  api.importPreview.mockResolvedValue(PREVIEW);
  api.importData.mockResolvedValue({ imported: 0, skipped: 0 });
  api.getPhotos.mockResolvedValue([]);
  const wrapper = mount(ImportModal);
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    value: [new File(['zip'], 'backup.zip')],
    configurable: true,
  });
  await input.trigger('change');
  await flushPromises();
  return wrapper;
}

const setupRow = (w: VueWrapper, name: string) =>
  w.findAll('[data-test="import-setup-row"]').find((r) => r.text().includes(name))!;
const radioFor = (w: VueWrapper, name: string, choice: string) =>
  setupRow(w, name).find(`input[type="radio"][value="${choice}"]`);
const confirmButton = (w: VueWrapper) => w.find('.btn-confirm');
const planCheckbox = (w: VueWrapper, name: string) =>
  w
    .findAll('.import-col')[0]
    .findAll('.export-photo-row')
    .find((r) => r.text().includes(name))!
    .find('input');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImportModal setups', () => {
  it('shows a setup that a ticked plan needs as ticked and locked, with the plan named', async () => {
    const w = await openDialog();
    const row = setupRow(w, 'New rig');
    const box = row.find('input').element as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(row.find('[data-test="import-setup-with-plan"]').text()).toBe('with plan Plan A');

    // Unticking the plan releases the setup.
    await planCheckbox(w, 'Plan A').setValue(false);
    const released = setupRow(w, 'New rig');
    expect((released.find('input').element as HTMLInputElement).disabled).toBe(false);
    expect(released.find('[data-test="import-setup-with-plan"]').exists()).toBe(false);
  });

  it('marks an identical setup as already present, with nothing to tick', async () => {
    const w = await openDialog();
    const row = setupRow(w, 'Same rig');
    expect(row.find('[data-test="import-setup-identical"]').text()).toBe(
      'settings.importSetupIdentical',
    );
    const box = row.find('input').element as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(row.find('[data-test="import-setup-choice"]').exists()).toBe(false);
  });

  it('offers three radio buttons for a different setup, and disables the confirm button until one is chosen', async () => {
    const w = await openDialog();
    const choice = setupRow(w, 'Diff rig').find('[data-test="import-setup-choice"]');
    const radios = () => choice.findAll('input[type="radio"]');
    expect(radios().map((r) => (r.element as HTMLInputElement).value)).toEqual([
      'replace',
      'keepBoth',
      'skip',
    ]);
    expect(choice.findAll('label').map((l) => l.text())).toEqual([
      'settings.importSetupReplace',
      'settings.importSetupKeepBoth',
      'settings.importSetupSkip',
    ]);

    // Nothing is chosen at first: the confirm button waits, and the name carries a warning mark.
    expect(radios().every((r) => !(r.element as HTMLInputElement).checked)).toBe(true);
    expect(confirmButton(w).attributes('disabled')).toBeDefined();
    expect(setupRow(w, 'Diff rig').find('.import-warn-icon').exists()).toBe(true);

    await radioFor(w, 'Diff rig', 'keepBoth').setValue(true);
    expect(confirmButton(w).attributes('disabled')).toBeUndefined();
    expect(setupRow(w, 'Diff rig').find('.import-warn-icon').exists()).toBe(false);
    expect((radioFor(w, 'Diff rig', 'keepBoth').element as HTMLInputElement).checked).toBe(true);
  });

  it('sends the choice as setupConflicts, for the different setup only', async () => {
    const w = await openDialog();
    await radioFor(w, 'Diff rig', 'replace').setValue(true);
    await confirmButton(w).trigger('click');
    await flushPromises();

    expect(api.importData).toHaveBeenCalledTimes(1);
    const opts = api.importData.mock.calls[0][1];
    expect(opts.setupConflicts).toEqual({ 'setup-diff': 'replace' });
    expect(opts.selectedPlans.sort()).toEqual(['plan-a', 'plan-b', 'plan-c']);
    // The identical setup is never offered for import.
    expect(opts.selectedSetups).not.toContain('setup-same');
  });

  it('"Do not import" on a setup no ticked plan needs unticks it and asks nothing more', async () => {
    const w = await openDialog();
    await planCheckbox(w, 'Plan C').setValue(false);
    await radioFor(w, 'Diff rig', 'skip').setValue(true);

    const row = setupRow(w, 'Diff rig');
    expect((row.find('input').element as HTMLInputElement).checked).toBe(false);
    expect(row.find('[data-test="import-setup-choice"]').exists()).toBe(false);
    expect(confirmButton(w).attributes('disabled')).toBeUndefined();

    await confirmButton(w).trigger('click');
    await flushPromises();
    const opts = api.importData.mock.calls[0][1];
    expect(opts.selectedSetups).not.toContain('setup-diff');
    expect(opts.setupConflicts).toEqual({});
  });

  it('keeps "Do not import" as a choice when a ticked plan needs the setup', async () => {
    const w = await openDialog();
    await radioFor(w, 'Diff rig', 'skip').setValue(true);
    expect((radioFor(w, 'Diff rig', 'skip').element as HTMLInputElement).checked).toBe(true);

    await confirmButton(w).trigger('click');
    await flushPromises();
    expect(api.importData.mock.calls[0][1].setupConflicts).toEqual({ 'setup-diff': 'skip' });
  });
});

describe('ImportModal failed items', () => {
  const toasts = () => vi.mocked(showToast).mock.calls.map((c) => c[0]);

  it('follows the result message with one line naming the items that failed', async () => {
    const w = await openDialog();
    api.importData.mockResolvedValue({
      imported: 1,
      skipped: 0,
      failed: [
        { kind: 'plan', name: 'Plan A' },
        { kind: 'photo', name: 'm31.jpg' },
      ],
    });
    await radioFor(w, 'Diff rig', 'replace').setValue(true);
    await confirmButton(w).trigger('click');
    await flushPromises();

    const messages = toasts().map((o) => o.message);
    expect(messages[0]).toBe('settings.importSuccess');
    expect(messages[1]).toBe('failed: Plan A, m31.jpg');
    expect(toasts()[1].type).toBe('error');
    expect(messages).toHaveLength(2);
  });

  it('adds no line when nothing failed', async () => {
    const w = await openDialog();
    api.importData.mockResolvedValue({ imported: 1, skipped: 0, failed: [] });
    await radioFor(w, 'Diff rig', 'replace').setValue(true);
    await confirmButton(w).trigger('click');
    await flushPromises();
    expect(toasts().map((o) => o.message)).toEqual(['settings.importSuccess']);
  });
});
