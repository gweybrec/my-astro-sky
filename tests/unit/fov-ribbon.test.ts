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
import type { FovFrameSpec } from '../../src/sky-map';

function makeSkyMap() {
  return {
    setFovFrames: vi.fn(),
    setFovRotationDeg: vi.fn(),
    setFovInstances: vi.fn(),
    setOnFovInstanceSelect: vi.fn(),
    setOnFovInstanceChange: vi.fn(),
  };
}

describe('FOVRibbon — onMounted frame initialisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a pending legacy centred override to the sky map', async () => {
    const specs: FovFrameSpec[] = [{ label: 'My Setup · 2.0° × 1.5°', wDeg: 2, hDeg: 1.5 }];
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: { canvas: { skyMap: sm, pendingFovOverride: specs } },
    });

    mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    expect(sm.setFovFrames).toHaveBeenCalledWith(specs);
    // Override is cleared so normal map switches don't reuse it
    expect(useCanvasStore(pinia).pendingFovOverride).toBeNull();
  });

  it('wires the interactive frame system to the sky map', async () => {
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: { canvas: { skyMap: sm, pendingFovOverride: null } },
    });

    mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    // Selection + change callbacks are registered on the map.
    expect(sm.setOnFovInstanceSelect).toHaveBeenCalled();
    expect(sm.setOnFovInstanceChange).toHaveBeenCalled();
    // The (empty) resolved frame list is pushed immediately via the watcher.
    expect(sm.setFovInstances).toHaveBeenCalledWith([]);
  });
});
