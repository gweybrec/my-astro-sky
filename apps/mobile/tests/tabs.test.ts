import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import TabsPage from '../src/pages/TabsPage.vue';
import { ionicStubs } from './helpers';

describe('the tab bar', () => {
  beforeEach(() => localStorage.setItem('lang', 'fr'));

  it('renders the five tabs in the order of the board, with translated labels and an icon each', () => {
    const wrapper = mount(TabsPage, { global: { stubs: ionicStubs } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map((b) => b.text())).toEqual([
      'Ciel',
      'Galerie',
      'Cibles',
      'Plans',
      'Réglages',
    ]);
    for (const b of buttons) expect(b.find('.mob-tab-pill svg').exists()).toBe(true);
  });
});
