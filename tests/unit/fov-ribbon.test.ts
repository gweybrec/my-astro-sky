import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { nextTick } from 'vue';

vi.mock('../../src/api', () => ({
  getGearSetups: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/fov-overlay', () => ({
  loadFovUiState: () => ({ frameRotationDeg: 0, ribbonOpen: true }),
  saveFovUiState: vi.fn(),
  buildFovFrameSpecs: vi.fn().mockResolvedValue([]),
  buildFovPopup: vi.fn().mockReturnValue(document.createElement('div')),
}));

vi.mock('../../src/ui', () => ({
  positionPopup: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  t: (k: string) => k,
}));

import FOVRibbon from '../../src/components/overlay/FOVRibbon.vue';
import { useCanvasStore } from '../../src/stores/canvas';
import * as api from '../../src/api';
import * as fovOverlay from '../../src/fov-overlay';
import type { FovFrameSpec } from '../../src/sky-map';

function makeSkyMap() {
  return {
    setFovFrames: vi.fn(),
    setFovRotationDeg: vi.fn(),
  };
}

describe('FOVRibbon — onMounted frame initialisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses pendingFovOverride and skips DB load', async () => {
    const specs: FovFrameSpec[] = [{ label: 'My Setup · 2.0° × 1.5°', wDeg: 2, hDeg: 1.5 }];
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: { canvas: { skyMap: sm, pendingFovOverride: specs } },
    });

    mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    // Override is applied to the sky map
    expect(sm.setFovFrames).toHaveBeenCalledWith(specs);
    // DB is not consulted
    expect(api.getGearSetups).not.toHaveBeenCalled();
    // Override is cleared so normal map switches don't reuse it
    expect(useCanvasStore(pinia).pendingFovOverride).toBeNull();
  });

  it('loads from DB when no pendingFovOverride', async () => {
    const dbSetups = [{ id: '1', enabled: true, name: 'Setup B', telescopeId: 't1', cameraId: 'c1', accessoryId: null }];
    const dbSpecs: FovFrameSpec[] = [{ label: 'Setup B · 3.0° × 2.0°', wDeg: 3, hDeg: 2 }];
    vi.mocked(api.getGearSetups).mockResolvedValue(dbSetups as any);
    vi.mocked(fovOverlay.buildFovFrameSpecs).mockResolvedValue(dbSpecs);

    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: { canvas: { skyMap: sm, pendingFovOverride: null } },
    });

    mount(FOVRibbon, { global: { plugins: [pinia] } });
    // Wait for the promise chain: getGearSetups → buildFovFrameSpecs → setFovFrames
    await new Promise(r => setTimeout(r, 0));

    expect(api.getGearSetups).toHaveBeenCalled();
    expect(fovOverlay.buildFovFrameSpecs).toHaveBeenCalledWith(dbSetups);
    expect(sm.setFovFrames).toHaveBeenCalledWith(dbSpecs);
  });
});
