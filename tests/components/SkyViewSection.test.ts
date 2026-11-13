/**
 * The "Ciels affichés" section of the side panel: shown only once a sky has been visited, with a button that opens
 * tick boxes for the user's sky and each visited sky, like the Catalogs list.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import SkyViewSection from '../../src/components/panels/SkyViewSection.vue';
import type { SharedSky } from '@myastrosky/core/domain/shared-sky';
import { MY_SKY } from '@myastrosky/core/shared-sky-view';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';

const visit = (id: string, senderName: string): SharedSky => ({
  id,
  senderName,
  sharedAt: '2026-03-01T10:00:00.000Z',
  receivedAt: '2026-03-02T10:00:00.000Z',
  photoCount: 1,
  bytes: 10,
  poiCategories: [],
});
const MARIE = visit('marie-sky', 'Marie Dupont');
const CLUB = visit('club-sky', 'Club astro des Vosges');

async function mountWith(skies: SharedSky[], shown: string[] = [MY_SKY]) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: { sharedSkies: { skies, shown } },
  });
  const wrapper = mount(SkyViewSection, { global: { plugins: [pinia] }, attachTo: document.body });
  await flushPromises();
  const store = useSharedSkiesStore(pinia);
  vi.mocked(store.show).mockResolvedValue();
  return { wrapper, store };
}

/** The tick boxes of the open list (teleported to the page). */
const rows = () =>
  [...document.body.querySelectorAll('.dropdown-panel label')].map((label) => [
    label.textContent?.trim(),
    (label.querySelector('input') as HTMLInputElement).checked,
  ]);

describe('"Skies shown" section', () => {
  it('is not shown before a sky has been visited', async () => {
    const { wrapper } = await mountWith([]);
    expect(wrapper.find('.sidebar-section').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows how many skies are ticked, and lists them as tick boxes', async () => {
    const { wrapper } = await mountWith([MARIE, CLUB], [MY_SKY, 'marie-sky']);
    expect(wrapper.find('.sidebar-section-header').text()).toContain('Skies shown');
    const button = wrapper.find('button.display-dropdown-btn');
    expect(button.text()).toBe('Skies (2)');
    await button.trigger('click');
    await flushPromises();
    expect(rows()).toEqual([
      ['Select all', false],
      ['My sky', true],
      ['Marie Dupont', true],
      ['Club astro des Vosges', false],
    ]);
    const all = document.body.querySelector('.dropdown-panel input') as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    wrapper.unmount();
  });

  it('ticks and unticks a sky, and all of them at once', async () => {
    const { wrapper, store } = await mountWith([MARIE, CLUB], [MY_SKY]);
    await wrapper.find('button.display-dropdown-btn').trigger('click');
    await flushPromises();
    const inputs = () =>
      [...document.body.querySelectorAll('.dropdown-panel input')] as HTMLInputElement[];

    inputs()[3].checked = true;
    inputs()[3].dispatchEvent(new Event('change'));
    expect(store.show).toHaveBeenLastCalledWith([MY_SKY, 'club-sky']);

    inputs()[1].checked = false;
    inputs()[1].dispatchEvent(new Event('change'));
    expect(store.show).toHaveBeenLastCalledWith([]);

    inputs()[0].checked = true;
    inputs()[0].dispatchEvent(new Event('change'));
    expect(store.show).toHaveBeenLastCalledWith([MY_SKY, 'marie-sky', 'club-sky']);
    wrapper.unmount();
  });
});
