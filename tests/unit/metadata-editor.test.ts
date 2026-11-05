import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { Photo } from '@myastrosky/core/types';

const api = vi.hoisted(() => ({
  solveWCS: vi.fn(),
  updatePhotoMetadata: vi.fn(),
  getGearSetups: vi.fn(() => Promise.resolve([])),
}));
const showToast = vi.hoisted(() => vi.fn());
const confirmWcsDimensionMismatch = vi.hoisted(() => vi.fn());
const showWcsConflicts = vi.hoisted(() => vi.fn());

vi.mock('../../src/api', () => api);
vi.mock('../../src/toast', () => ({ showToast }));
vi.mock('../../src/photo-delete-confirm', () => ({ confirmWcsDimensionMismatch }));
vi.mock('../../src/wcs-conflicts', () => ({ showWcsConflicts }));
// The form itself is not under test: only the draft it is given.
vi.mock('../../src/components/modals/MetadataEditorPanel.vue', () => ({
  default: { render: () => null },
}));

import { buildMetadataEditorPanel } from '../../src/metadata-editor';

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
    confirmWcsDimensionMismatch.mockResolvedValue(false);
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    expect(confirmWcsDimensionMismatch).toHaveBeenCalled();
    expect(showWcsConflicts).not.toHaveBeenCalled();
    expect((await saved(container)).captureDetails).toEqual({ gain: 100 });
  });

  it('fills empty fields and replaces only the conflicts the user keeps ticked', async () => {
    api.solveWCS.mockResolvedValue({
      success: true,
      dateObs: '2024-01-02T03:04:05.000Z',
      captureDetails: { gain: 200, iso: 800 },
    });
    // Keeps the date already there, takes the gain of the file.
    showWcsConflicts.mockImplementation(async (conflicts: { key: string }[]) =>
      conflicts.filter((c) => c.key === 'capture.gain'),
    );
    buildMetadataEditorPanel(container, photo(), vi.fn(), vi.fn());
    await loadFile(container);
    expect(confirmWcsDimensionMismatch).not.toHaveBeenCalled();
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
});
