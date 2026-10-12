import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
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

  it('is wrapped in an IonPage (the Ionic Vue router needs it, or going back to the tabs fails)', () => {
    const page = defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', { 'data-ion-page': '' }, slots.default?.()),
    });
    const wrapper = mount(TabsPage, { global: { stubs: { ...ionicStubs, IonPage: page } } });
    const root = wrapper.element as HTMLElement;
    expect(root.hasAttribute('data-ion-page')).toBe(true);
    expect(root.querySelector('nav')).not.toBeNull();
  });
});
