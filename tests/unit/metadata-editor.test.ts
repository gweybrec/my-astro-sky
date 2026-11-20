import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';

const api = vi.hoisted(() => ({
  solveWCS: vi.fn(),
  updatePhotoMetadata: vi.fn(),
  getGearSetups: vi.fn(() => Promise.resolve([])),
  getPhotoFitsHeaders: vi.fn(() => Promise.resolve([])),
  setPhotoFitsHeaders: vi.fn(() => Promise.resolve()),
}));
const showToast = vi.hoisted(() => vi.fn());
const dialogs = vi.hoisted(() => ({
  confirmWcsWarnings: vi.fn(() => Promise.resolve(true)),
  showFitsHeaders: vi.fn(() => Promise.resolve()),
}));
const showWcsConflicts = vi.hoisted(() => vi.fn());

vi.mock('../../src/api', () => api);
// The WCS reading flow is shared and calls the package's data functions.
vi.mock('@myastrosky/app-state/api', () => api);
vi.mock('../../src/toast', () => ({ showToast }));
vi.mock('../../src/wcs-dialogs', () => dialogs);
vi.mock('../../src/wcs-conflicts', () => ({ showWcsConflicts }));
// The form itself is not under test: only the draft it is given.
vi.mock('../../src/components/modals/MetadataEditorPanel.vue', () => ({
  default: { render: () => null },
}));
vi.mock('../../src/components/modals/MetadataSheet.vue', () => ({
  default: { render: () => null },
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: reportError }));

import { buildMetadataEditorPanel, showMetadataEditor } from '../../src/metadata-editor';
import { t } from '../../src/i18n';

const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M31.jpg',
    width: 4000,
    height: 2000,
    dsoIds: [],
    labels: [],
    observationDate: '2023-05-05T00:00:00.000Z',
    integrations: [],
    captureDetails: { gain: 100 },
    ...over,
  }) as unknown as Photo;

async function loadFile(container: HTMLElement, name = 'm31.fits') {
  const input = container.querySelector<HTMLInputElement>('.wcs-load-row input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], name)], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flushPromises();
}

async function saved(container: HTMLElement) {
  container.querySelector<HTMLButtonElement>('.meta-editor-btns .btn-confirm')!.click();
  await flushPromises();
  return api.updatePhotoMetadata.mock.calls[0][1];
}

/** One correspondence: the file is solved, but too few points to compare its field. */
const CORR = [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 0, starName: '' }];

describe('buildMetadataEditorPanel, loading a WCS file', () => {
  let container: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('sends the photo size and explains a file that was not plate-solved', async () => {
    api.solveWCS.mockResolvedValue({ success: false, code: 'NO_WCS_DATA' });
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container, 'brut.fits');
    expect(api.solveWCS.mock.calls[0].slice(1)).toEqual([4000, 2000]);
    expect(showToast.mock.calls[0][0].message).toContain('brut.fits');
    expect(showToast.mock.calls[0][0].type).toBe('error');
  });

  it('shows the thrown error text, not a generic one', async () => {
    api.solveWCS.mockRejectedValue(new Error('Serveur injoignable'));
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    expect(showToast.mock.calls[0][0].message).toContain('Serveur injoignable');
  });

  it('takes nothing when the user cancels the size warning', async () => {
    api.solveWCS.mockResolvedValue({
      success: true,
      correspondences: CORR,
      dateObs: '2024-01-02T03:04:05.000Z',
      captureDetails: { iso: 800 },
      dimensionWarning: {
        sourceW: 3000,
        sourceH: 3000,
        targetW: 4000,
        targetH: 2000,
        aspectMismatch: true,
      },
    });
    dialogs.confirmWcsWarnings.mockResolvedValueOnce(false);
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    expect(dialogs.confirmWcsWarnings).toHaveBeenCalledWith('m31.fits', [
      expect.stringContaining('3000'),
    ]);
    expect(showWcsConflicts).not.toHaveBeenCalled();
    expect((await saved(container)).captureDetails).toEqual({ gain: 100 });
  });

  it('fills empty fields and replaces only the conflicts the user keeps ticked', async () => {
    api.solveWCS.mockResolvedValue({
      success: true,
      correspondences: CORR,
      dateObs: '2024-01-02T03:04:05.000Z',
      captureDetails: { gain: 200, iso: 800 },
    });
    // Keeps the date already there, takes the gain of the file.
    showWcsConflicts.mockImplementation(async (conflicts: { key: string }[]) =>
      conflicts.filter((c) => c.key === 'capture.gain'),
    );
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    expect(dialogs.confirmWcsWarnings).not.toHaveBeenCalled();
    expect(showWcsConflicts.mock.calls[0][0].map((c: { key: string }) => c.key)).toEqual([
      'observationDate',
      'capture.gain',
    ]);
    const meta = await saved(container);
    expect(meta.observationDate).toBe('2023-05-05T00:00:00.000Z');
    expect(meta.captureDetails).toEqual({ gain: 200, iso: 800 });
  });

  it('takes nothing at all when the conflict list is cancelled', async () => {
    api.solveWCS.mockResolvedValue({
      success: true,
      correspondences: CORR,
      dateObs: '2024-01-02T03:04:05.000Z',
      captureDetails: { iso: 800 },
    });
    showWcsConflicts.mockResolvedValue(null);
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    const meta = await saved(container);
    expect(meta.captureDetails).toEqual({ gain: 100 });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('loads the capture data and the headers of a file that is not plate-solved, and saves the headers', async () => {
    const cards = [{ key: 'EXPTIME', value: '30.' }];
    api.solveWCS.mockResolvedValue({
      success: false,
      code: 'NO_WCS_DATA',
      expTime: 30,
      stackCnt: 44,
      captureDetails: { ccdTemp: 9.9 },
      fitsHeaders: cards,
    });
    const onSaved = vi.fn();
    buildMetadataEditorPanel(container, photo(), onSaved, vi.fn());
    const headersBtn = container.querySelector<HTMLButtonElement>('[data-test=fits-headers-btn]')!;
    expect(headersBtn.getAttribute('aria-disabled')).toBe('true');
    await loadFile(container, 'M2.fit');
    expect(showToast.mock.calls[0][0]).toMatchObject({ type: 'warning' });
    expect(showToast.mock.calls[0][0].message).toContain('M2.fit');
    expect(headersBtn.hasAttribute('aria-disabled')).toBe(false);
    headersBtn.click();
    expect(dialogs.showFitsHeaders).toHaveBeenCalledWith(cards);

    const meta = await saved(container);
    expect(meta.integrations).toEqual([{ frames: 44, seconds: 30, filter: '' }]);
    expect(meta.captureDetails).toEqual({ gain: 100, ccdTemp: 9.9 });
    expect(api.setPhotoFitsHeaders).toHaveBeenCalledWith('p1', cards);
    expect(onSaved.mock.calls[0][0].hasFitsHeaders).toBe(true);
  });

  it('shows the stored headers of a photo that has some, and saves none when no file was read', async () => {
    buildMetadataEditorPanel(container, photo({ hasFitsHeaders: true }), vi.fn(), vi.fn());
    const headersBtn = container.querySelector<HTMLButtonElement>('[data-test=fits-headers-btn]')!;
    expect(headersBtn.hasAttribute('aria-disabled')).toBe(false);
    headersBtn.click();
    const load = dialogs.showFitsHeaders.mock.calls[0][0] as unknown as () => Promise<unknown>;
    await load();
    expect(api.getPhotoFitsHeaders).toHaveBeenCalledWith('p1');
    await saved(container);
    expect(api.setPhotoFitsHeaders).not.toHaveBeenCalled();
  });

  it('greys out the headers of a manually placed photo and says why when pressed', () => {
    const manualPlacement = {
      centerRa: 10,
      centerDec: 41,
      rotationDeg: 0,
      projPerPx: 1e-5,
      mirrorX: false,
      mirrorY: false,
    };
    buildMetadataEditorPanel(container, photo({ manualPlacement }), vi.fn(), vi.fn());
    const headersBtn = container.querySelector<HTMLButtonElement>('[data-test=fits-headers-btn]')!;
    expect(headersBtn.getAttribute('aria-disabled')).toBe('true');
    headersBtn.click();
    expect(dialogs.showFitsHeaders).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toMatchObject({
      message: t('modal.fitsHeadersNoneManual'),
      type: 'info',
    });
  });

  it('says no file was read for a photo without headers that was not placed by hand', () => {
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    container.querySelector<HTMLButtonElement>('[data-test=fits-headers-btn]')!.click();
    expect(showToast.mock.calls[0][0].message).toBe(t('modal.fitsHeadersNone'));
  });

  it('has no headers button in the stand-alone editor', () => {
    showMetadataEditor(photo({ hasFitsHeaders: true }), vi.fn());
    const modal = document.querySelector('.meta-editor-overlay')!;
    expect(modal.querySelector('[data-test=fits-headers-btn]')).toBeNull();
    modal.remove();
  });
});

describe('buildMetadataEditorPanel, as the gallery sheet', () => {
  let container: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    api.updatePhotoMetadata.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const build = (p = photo(), onSaved = vi.fn(), onPois = vi.fn()) =>
    buildMetadataEditorPanel(container, p, onSaved, vi.fn(), [], [], onPois, { sheet: true });

  it('has no Save button, and puts the headers before the WCS file', () => {
    build();
    expect(container.querySelector('.meta-editor-btns')).toBeNull();
    const row = container.querySelector('.wcs-load-row')!;
    const buttons = Array.from(row.querySelectorAll('button'));
    expect(buttons[0].dataset.test).toBe('fits-headers-btn');
    expect(buttons[1].textContent?.trim()).toBe(t('gallery.sheet.loadWcs'));
    expect(buttons[1].title).toBe(t('gallery.loadFromWcs'));
  });

  it('saves a change at once, with the other fields as they stand, and reports the saved photo', async () => {
    const onSaved = vi.fn();
    const onPois = vi.fn();
    const panel = build(photo({ notes: 'old', labels: ['a'] }), onSaved, onPois);
    expect(await panel.saveFields({ notes: 'new' })).toBe(true);
    const meta = api.updatePhotoMetadata.mock.calls[0][1];
    expect(meta).toMatchObject({ notes: 'new', labels: ['a'], captureDetails: { gain: 100 } });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: 'p1', notes: 'new' });
    expect(onPois).not.toHaveBeenCalled();

    // The next save starts from the saved draft.
    await panel.saveFields({ labels: ['a', 'b'] });
    expect(api.updatePhotoMetadata.mock.calls[1][1]).toMatchObject({
      notes: 'new',
      labels: ['a', 'b'],
    });
  });

  it('renames the photo through its name', async () => {
    const onSaved = vi.fn();
    const panel = build(photo(), onSaved);
    await panel.saveFields({ displayName: 'Andromède' });
    expect(api.updatePhotoMetadata.mock.calls[0][1].originalName).toBe('Andromède');
    expect(onSaved.mock.calls[0][0].originalName).toBe('Andromède');
  });

  it('tells the photo view about changed points of interest', async () => {
    const onPois = vi.fn();
    const panel = build(photo(), vi.fn(), onPois);
    const pois = [{ name: 'C/2025 A1', categoryId: 'comet' }];
    await panel.saveFields({ pointsOfInterest: pois as never });
    expect(onPois).toHaveBeenCalledWith(pois);
  });

  it('keeps the draft and says why when the save fails', async () => {
    api.updatePhotoMetadata.mockRejectedValueOnce(new Error('Disque plein'));
    const onSaved = vi.fn();
    const panel = build(photo({ notes: 'old' }), onSaved);
    expect(await panel.saveFields({ notes: 'new' })).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toMatchObject({ message: 'Disque plein', type: 'error' });
    expect(reportError).toHaveBeenCalled();
    // Not taken: the next save still has the old notes.
    await panel.saveFields({ labels: ['x'] });
    expect(api.updatePhotoMetadata.mock.calls[1][1].notes).toBe('old');
  });

  it('saves one change after the other, in order', async () => {
    let release!: () => void;
    api.updatePhotoMetadata.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const panel = build();
    const first = panel.saveFields({ notes: 'one' });
    const second = panel.saveFields({ labels: ['two'] });
    await flushPromises();
    expect(api.updatePhotoMetadata).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(api.updatePhotoMetadata.mock.calls[1][1]).toMatchObject({
      notes: 'one',
      labels: ['two'],
    });
  });

  it('is never "dirty" by itself: nothing waits for a Save', () => {
    const panel = build();
    expect(panel.isDirty()).toBe(false);
  });

  it('saves a loaded WCS file at once, its values and its header cards', async () => {
    const cards = [{ key: 'EXPTIME', value: '30.' }];
    api.solveWCS.mockResolvedValue({
      success: false,
      code: 'NO_WCS_DATA',
      expTime: 30,
      stackCnt: 44,
      captureDetails: { ccdTemp: 9.9 },
      fitsHeaders: cards,
    });
    const onSaved = vi.fn();
    build(photo(), onSaved);
    await loadFile(container, 'M2.fit');
    const meta = api.updatePhotoMetadata.mock.calls[0][1];
    expect(meta.integrations).toEqual([{ frames: 44, seconds: 30, filter: '' }]);
    expect(meta.captureDetails).toEqual({ gain: 100, ccdTemp: 9.9 });
    expect(api.setPhotoFitsHeaders).toHaveBeenCalledWith('p1', cards);
    expect(onSaved.mock.calls.at(-1)![0].hasFitsHeaders).toBe(true);
    const headersBtn = container.querySelector<HTMLButtonElement>('[data-test=fits-headers-btn]')!;
    expect(headersBtn.hasAttribute('aria-disabled')).toBe(false);
  });
});
