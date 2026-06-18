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
import { useFovFramesStore } from '../../src/stores/fov-frames';
import type { FovFrameSpec } from '../../src/sky-map';

function makeSkyMap() {
  return {
    setFovFrames: vi.fn(),
    setFovRotationDeg: vi.fn(),
    setFovInstances: vi.fn(),
    setOnFovInstanceSelect: vi.fn(),
    setOnFovInstanceChange: vi.fn(),
    setOnFovFrameResize: vi.fn(),
    setOnMosaicTileRemove: vi.fn(),
    setOnMosaicTileAdd: vi.fn(),
    setMosaicAddCandidates: vi.fn(),
    setOnFrameMerge: vi.fn(),
    pinAllFloatingFrames: vi.fn(),
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

describe('FOVRibbon — master show/hide-frames toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the eye button and toggles framesVisible on click', async () => {
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: { canvas: { skyMap: sm, pendingFovOverride: null } },
    });
    const wrapper = mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    const fovStore = useFovFramesStore(pinia);
    const eyeBtn = wrapper.find('.fov-visibility-btn');
    expect(eyeBtn.exists()).toBe(true);
    // Default visible → tooltip offers to hide.
    expect(eyeBtn.attributes('title')).toBe('fovOverlay.hideFrames');

    await eyeBtn.trigger('click');
    expect(fovStore.toggleFramesVisible).toHaveBeenCalled();
  });

  it('freezes floating frames to the sky before hiding (nothing drifts while hidden)', async () => {
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        canvas: { skyMap: sm, pendingFovOverride: null },
        fovFrames: { framesVisible: true },
      },
    });
    const wrapper = mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    await wrapper.find('.fov-visibility-btn').trigger('click');
    // Floating frames are pinned to the sky first, then the toggle hides them.
    expect(sm.pinAllFloatingFrames).toHaveBeenCalledTimes(1);
    expect(useFovFramesStore(pinia).toggleFramesVisible).toHaveBeenCalledTimes(1);
  });

  it('does not pin frames when showing them again', async () => {
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        canvas: { skyMap: sm, pendingFovOverride: null },
        fovFrames: { framesVisible: false },
      },
    });
    const wrapper = mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    await wrapper.find('.fov-visibility-btn').trigger('click');
    expect(sm.pinAllFloatingFrames).not.toHaveBeenCalled();
    expect(useFovFramesStore(pinia).toggleFramesVisible).toHaveBeenCalledTimes(1);
  });

  it('dims the rotation buttons when frames are hidden', async () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        canvas: { skyMap: makeSkyMap(), pendingFovOverride: null },
        fovFrames: { framesVisible: false, activeId: 'adhoc-1' },
      },
    });
    const wrapper = mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    // Even with an active frame, hidden frames disable the rotation buttons.
    const rotateBtn = wrapper.find('.fov-rotate-btn');
    expect(rotateBtn.classes()).toContain('opacity-40');
    expect(rotateBtn.classes()).toContain('pointer-events-none');
    // The eye button itself stays interactive and offers to show frames.
    expect(wrapper.find('.fov-visibility-btn').attributes('title')).toBe('fovOverlay.showFrames');
  });

  it('pushes an empty frame set to the map while frames are hidden', async () => {
    const sm = makeSkyMap();
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        canvas: { skyMap: sm, pendingFovOverride: null },
        fovFrames: { framesVisible: false },
      },
    });
    mount(FOVRibbon, { global: { plugins: [pinia] } });
    await nextTick();

    expect(sm.setFovInstances).toHaveBeenCalledWith([]);
  });
});
