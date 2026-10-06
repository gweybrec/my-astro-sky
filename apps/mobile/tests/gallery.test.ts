import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const getPhotos = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({ getPhotos: () => getPhotos(), getPlans: vi.fn() }));

import GalleryPage from '../src/pages/GalleryPage.vue';

describe('the gallery page', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    getPhotos.mockReset();
  });

  it('shows the empty state when the backend returns no photo', async () => {
    getPhotos.mockResolvedValue([]);
    const wrapper = mount(GalleryPage, { global: { stubs: ionicStubs } });
    await flushPromises();
    expect(wrapper.find('.mob-empty-text').text()).toBe("Aucune photo pour l'instant");
    expect(wrapper.find('.mob-empty button').text()).toBe('Ajouter des photos');
    expect(wrapper.find('input[type=search]').attributes('placeholder')).toBe(
      'Rechercher une photo…',
    );
  });

  it('shows no empty state when there are photos, nor before the answer', async () => {
    getPhotos.mockResolvedValue([{ id: 'p1' }]);
    const wrapper = mount(GalleryPage, { global: { stubs: ionicStubs } });
    expect(wrapper.find('.mob-empty').exists()).toBe(false);
    await flushPromises();
    expect(wrapper.find('.mob-empty').exists()).toBe(false);
  });
});
