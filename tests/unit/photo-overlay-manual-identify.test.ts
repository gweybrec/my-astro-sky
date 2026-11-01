import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PhotoOverlay } from '../../src/photo-overlay';

const VIEW = {
  centerX: 0,
  centerY: 0,
  scale: 500,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

// The batch dialog's backdrop, left open behind the manual-identify dialog.
describe('PhotoOverlay manual identify: host backdrop over the map', () => {
  let hostBackdrop: HTMLDivElement;
  let overlay: PhotoOverlay;
  let onPick: ((star: any) => void) | null;
  const skyMap = {
    enterPickingMode: vi.fn((cb: (star: any) => void) => {
      onPick = cb;
    }),
    exitPickingMode: vi.fn(),
    setOnViewChange: vi.fn(),
  };

  beforeEach(() => {
    onPick = null;
    hostBackdrop = document.createElement('div');
    hostBackdrop.className = 'modal-backdrop';
    document.body.appendChild(hostBackdrop);
    overlay = new PhotoOverlay(document.createElement('div'), () => VIEW as any, skyMap as any);
    if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:test';
    if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {};
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function open() {
    const file = new File(['x'], 'm42.jpg', { type: 'image/jpeg' });
    return overlay.openManualIdentifyModal(file, { hostBackdrop });
  }

  it('hides the host backdrop while a star is picked on the map, then restores it', () => {
    void open();
    const pickBtn = document.querySelector<HTMLButtonElement>('.btn-pick-map')!;
    pickBtn.click();
    expect(hostBackdrop.style.display).toBe('none');

    onPick!({ ra: 83.8, dec: -5.4, mag: 1, name: 'Test' });
    expect(hostBackdrop.style.display).toBe('');
  });

  it('restores the host backdrop when map picking is cancelled with Escape', () => {
    void open();
    document.querySelector<HTMLButtonElement>('.btn-pick-map')!.click();
    expect(hostBackdrop.style.display).toBe('none');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hostBackdrop.style.display).toBe('');
  });

  it('hides the host backdrop during the free-drag hand-off until it is cancelled', async () => {
    const result = open();
    document.querySelector<HTMLButtonElement>('.btn-auto-solve.full-width')!.click();
    expect(await result).toEqual({ action: 'manual-placement' });
    expect(hostBackdrop.style.display).toBe('none');

    document.querySelector<HTMLButtonElement>('.manual-toolbar .btn-cancel')!.click();
    expect(hostBackdrop.style.display).toBe('');
  });
});
