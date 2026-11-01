import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';

// The modal host only switches modals; every child is stubbed except the batch
// upload modal, replaced by a stub that records whether it was ever unmounted.
const batch = vi.hoisted(() => ({ unmounts: 0 }));

vi.mock('../../src/composables/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../src/stores/ui', () => ({
  useUiStore: () => ({ targetsOverlayOpen: false, pendingPoiAddPhoto: { id: 'p1' } }),
}));
vi.mock('../../src/components/modals/BatchUploadModal.vue', async () => {
  const { defineComponent, h, onUnmounted } = await import('vue');
  return {
    default: defineComponent({
      name: 'BatchUploadModal',
      setup() {
        onUnmounted(() => batch.unmounts++);
        return () => h('div', { class: 'batch-stub' });
      },
    }),
  };
});

import MyAstroSkyApp from '../../src/MyAstroSkyApp.vue';

describe('MyAstroSkyApp modal host', () => {
  it('keeps the batch upload modal mounted while a dialog opened from it is active', async () => {
    const wrapper = shallowMount(MyAstroSkyApp, {
      global: { stubs: { teleport: true, BatchUploadModal: false } },
    });
    const host = wrapper.vm as unknown as { openModal: (name: string) => void };

    host.openModal('batchUpload');
    await nextTick();
    const batchEl = () => wrapper.find('.batch-stub');
    expect(batchEl().exists()).toBe(true);

    // A batch card's POI editor opens Add POI: the batch stays mounted underneath.
    host.openModal('poiAdd');
    await nextTick();
    expect(batchEl().exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'PoiAddModal' }).exists()).toBe(true);

    // Closing Add POI returns to the same batch instance.
    wrapper.findComponent({ name: 'PoiAddModal' }).vm.$emit('close');
    await nextTick();
    expect(batchEl().exists()).toBe(true);
    expect(batch.unmounts).toBe(0);

    // Closing the batch itself still unmounts it.
    wrapper.findComponent({ name: 'BatchUploadModal' }).vm.$emit('close');
    await nextTick();
    expect(batchEl().exists()).toBe(false);
    expect(batch.unmounts).toBe(1);
  });
});
