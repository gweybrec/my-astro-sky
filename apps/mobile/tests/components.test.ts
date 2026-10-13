import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';
import PhoneButton from '../src/components/PhoneButton.vue';
import PhoneIconButton from '../src/components/PhoneIconButton.vue';
import PhoneRow from '../src/components/PhoneRow.vue';
import PhoneEmptyState from '../src/components/PhoneEmptyState.vue';
import PhoneChip from '../src/components/PhoneChip.vue';
import PhoneBadge from '../src/components/PhoneBadge.vue';
import PhoneSheet from '../src/components/PhoneSheet.vue';
import PhoneSearch from '../src/components/PhoneSearch.vue';
import PhoneField from '../src/components/PhoneField.vue';
import PhoneBusy from '../src/components/PhoneBusy.vue';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';

const global = { stubs: ionicStubs };

describe('the shared phone components', () => {
  beforeEach(() => localStorage.setItem('lang', 'fr'));

  it('PhoneButton carries the design system classes of its role and size', () => {
    const w = mount(PhoneButton, {
      props: { variant: 'confirm', size: 'lg', block: true },
      slots: { default: 'Valider' },
      global,
    });
    const cls = w.find('button').classes();
    expect(cls).toEqual(
      expect.arrayContaining(['mob-btn', 'mob-btn--confirm', 'mob-btn--lg', 'mob-btn--block']),
    );
    expect(cls).toContain('m-body-strong');
    expect(w.text()).toBe('Valider');
  });

  it('PhoneButton uses the plain weight by default and the secondary size for a field', () => {
    const plain = mount(PhoneButton, { slots: { default: 'x' }, global });
    expect(plain.find('button').classes()).toContain('m-body');
    const field = mount(PhoneButton, {
      props: { variant: 'field' },
      slots: { default: 'x' },
      global,
    });
    expect(field.find('button').classes()).toEqual(
      expect.arrayContaining(['mob-btn--field', 'm-secondary']),
    );
  });

  it('PhoneIconButton gives its name to assistive technology and emits a tap', async () => {
    const w = mount(PhoneIconButton, { props: { label: 'Ajouter' }, global });
    expect(w.find('button').attributes('aria-label')).toBe('Ajouter');
    await w.find('button').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });

  describe('long press on an icon button', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('shows the name beside the button and does not count the press as a tap', async () => {
      const w = mount(PhoneIconButton, {
        props: { label: 'Supprimer' },
        global,
        attachTo: document.body,
      });
      const button = w.find('button');
      await button.trigger('pointerdown');
      vi.advanceTimersByTime(600);
      await w.vm.$nextTick();
      const label = document.body.querySelector('.mob-longpress-label');
      expect(label?.textContent?.trim()).toBe('Supprimer');
      expect(button.classes()).toContain('mob-icon-btn--held');
      await button.trigger('pointerup');
      await button.trigger('click');
      expect(w.emitted('click')).toBeUndefined();
      expect(document.body.querySelector('.mob-longpress-label')).toBeNull();
      w.unmount();
    });

    it('shows nothing on a short tap', async () => {
      const w = mount(PhoneIconButton, {
        props: { label: 'Supprimer' },
        global,
        attachTo: document.body,
      });
      const button = w.find('button');
      await button.trigger('pointerdown');
      vi.advanceTimersByTime(100);
      await button.trigger('pointerup');
      await button.trigger('click');
      expect(document.body.querySelector('.mob-longpress-label')).toBeNull();
      expect(w.emitted('click')).toHaveLength(1);
      w.unmount();
    });
  });

  it('PhoneRow prints the title, the lines under it, the value and the chevron', async () => {
    const w = mount(PhoneRow, {
      props: { title: 'Équipement 1', subs: ['a', 'b'], value: '3', chevron: true, button: true },
      global,
    });
    expect(w.find('.mob-row-title').text()).toBe('Équipement 1');
    expect(w.findAll('.mob-row-sub').map((s) => s.text())).toEqual(['a', 'b']);
    expect(w.find('.mob-row-trail').text()).toContain('3');
    expect(w.find('.mob-row-chevron svg').exists()).toBe(true);
    await w.find('.mob-row').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });

  it('PhoneRow marks the delete and disabled rows', () => {
    const w = mount(PhoneRow, { props: { title: 'x', danger: true, disabled: true }, global });
    expect(w.find('.mob-row').classes()).toEqual(
      expect.arrayContaining(['mob-row--danger', 'mob-row--disabled']),
    );
  });

  it('PhoneEmptyState shows the text and one button that emits the action', async () => {
    const w = mount(PhoneEmptyState, { props: { text: 'Rien', buttonLabel: 'Ajouter' }, global });
    expect(w.find('.mob-empty-text').text()).toBe('Rien');
    await w.find('button').trigger('click');
    expect(w.emitted('action')).toHaveLength(1);
  });

  it('PhoneChip reports its selected state and PhoneBadge its kind', () => {
    const chip = mount(PhoneChip, { props: { pressed: true }, slots: { default: 'x' }, global });
    expect(chip.find('div').attributes('aria-pressed')).toBe('true');
    const badge = mount(PhoneBadge, {
      props: { kind: 'const' },
      slots: { default: 'And' },
      global,
    });
    expect(badge.find('span').classes()).toContain('mob-badge--const');
  });

  it('PhoneSheet shows its title, its body and its footer, and closes from the handle', async () => {
    const w = mount(PhoneSheet, {
      props: { open: true, title: 'Affichage' },
      slots: { default: '<p id="body">corps</p>', footer: '<button id="ok">Valider</button>' },
      global,
    });
    expect(w.find('h2').text()).toBe('Affichage');
    expect(w.find('#body').exists()).toBe(true);
    expect(w.find('.mob-sheet-footer #ok').exists()).toBe(true);
    await w.find('.mob-sheet-grab').trigger('click');
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('PhoneSheet is Ionic sheet with breakpoints 0 and 1, so a drag down closes it like the backdrop', async () => {
    const w = mount(PhoneSheet, { props: { open: true, title: 'x' }, global });
    const modal = w.find('.mob-sheet-modal');
    // The content's height is breakpoint 1; dropping below it dismisses the modal (Ionic's own gesture).
    expect(modal.attributes('breakpoints')).toBe('0,1');
    expect(modal.attributes('initial-breakpoint')).toBe('1');
    expect(modal.attributes('handle')).toBe('false');
    // The body is a scroll host: Ionic lets it scroll before it lets the sheet move.
    expect(w.find('.mob-sheet-body').classes()).toContain('ion-content-scroll-host');
    await modal.trigger('did-dismiss');
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('PhoneSheet has no close button, with or without a footer', () => {
    const w = mount(PhoneSheet, { props: { open: true, title: 'x' }, global });
    expect(w.find('.mob-sheet-footer').exists()).toBe(false);
    // The only button is the handle that the sheet is dragged down by.
    expect(w.findAll('button').map((b) => b.classes())).toEqual([['mob-sheet-grab']]);
  });

  it('PhoneSearch and PhoneField are text inputs with the design system classes', () => {
    const s = mount(PhoneSearch, {
      props: { placeholder: 'Rechercher', label: 'Recherche' },
      global,
    });
    const input = s.find('input');
    expect(input.classes()).toContain('mob-search');
    expect(input.attributes('placeholder')).toBe('Rechercher');
    expect(input.attributes('aria-label')).toBe('Recherche');
    const f = mount(PhoneField, { props: { label: 'Hauteur', unit: 'm' }, global });
    expect(f.find('label').text()).toBe('Hauteur');
    expect(f.find('.phone-field-unit').text()).toBe('m');
  });

  it('PhoneBusy shows the spinner and its label', () => {
    const w = mount(PhoneBusy, { props: { label: 'Résolution…' }, global });
    expect(w.attributes('role')).toBe('status');
    expect(w.text()).toBe('Résolution…');
  });

  it('PhoneNativePicker holds a hidden input of its type and passes on the picked value, not an emptied one', () => {
    const w = mount(PhoneNativePicker, { props: { type: 'time', value: '21:30' }, global });
    const input = w.find('input');
    expect(input.attributes('type')).toBe('time');
    expect(input.attributes('aria-hidden')).toBe('true');
    expect(w.classes()).toContain('mob-picker-inputs');
    const stub = w.findComponent(ionicStubs.IonInput);
    stub.vm.$emit('ionChange', { detail: { value: '22:15' } });
    stub.vm.$emit('ionChange', { detail: { value: '' } });
    expect(w.emitted('pick')).toEqual([['22:15']]);
  });
});
