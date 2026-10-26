import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick } from 'vue';
import { ionicStubs } from './helpers';
import PhoneButton from '../src/components/PhoneButton.vue';
import PhoneIconButton from '../src/components/PhoneIconButton.vue';
import PhoneRow from '../src/components/PhoneRow.vue';
import PhoneEmptyState from '../src/components/PhoneEmptyState.vue';
import PhoneChip from '../src/components/PhoneChip.vue';
import PhoneBadge from '../src/components/PhoneBadge.vue';
import PhoneSheet from '../src/components/PhoneSheet.vue';
import PhoneMapSheet from '../src/components/PhoneMapSheet.vue';
import PhoneMapSheetHost from '../src/components/PhoneMapSheetHost.vue';
import PhoneSearch from '../src/components/PhoneSearch.vue';
import PhoneField from '../src/components/PhoneField.vue';
import PhoneBusy from '../src/components/PhoneBusy.vue';
import PhoneNativePicker from '../src/components/PhoneNativePicker.vue';
import PhoneBackButton from '../src/components/PhoneBackButton.vue';
import {
  contentStops,
  sheetMarks,
  sheetRows,
  sheetStops,
  underLastRow,
} from '../src/composables/useSheetStops';
import PhoneFacts from '../src/components/PhoneFacts.vue';

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

  it('PhoneButton busy keeps its label after a spinner, is not disabled, and says it is busy', () => {
    const w = mount(PhoneButton, {
      props: { variant: 'confirm', busy: true },
      slots: { default: 'Valider' },
      global,
    });
    const button = w.find('button');
    expect(button.classes()).toContain('mob-btn--busy');
    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(button.attributes('aria-disabled')).toBe('true');
    const content = button.find('.mob-btn-content');
    expect(content.element.firstElementChild?.classList.contains('mob-spinner')).toBe(true);
    expect(w.text()).toBe('Valider');
    const idle = mount(PhoneButton, { slots: { default: 'Valider' }, global });
    expect(idle.find('.mob-spinner').exists()).toBe(false);
    expect(idle.find('button').attributes('aria-busy')).toBeUndefined();
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

    it('sets only the measured edges of the button: the gap and the centring are the stylesheet’s', async () => {
      const w = mount(PhoneIconButton, {
        props: { label: 'Supprimer' },
        global,
        attachTo: document.body,
      });
      const button = w.find('button');
      // A button in the right half of a 400 px wide screen: the label goes at its left.
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
      vi.spyOn(button.element, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(300, 100, 48, 48),
      );
      await button.trigger('pointerdown');
      vi.advanceTimersByTime(600);
      await w.vm.$nextTick();
      const anchor = document.body.querySelector<HTMLElement>('.mob-longpress-anchor');
      expect(anchor?.classList).toContain('mob-longpress-anchor--start');
      const props = Array.from(anchor?.style ?? []).sort();
      expect(props).toEqual(['--longpress-edge', '--longpress-height', '--longpress-top']);
      expect(anchor?.style.getPropertyValue('--longpress-edge')).toBe('100px');
      expect(anchor?.style.getPropertyValue('--longpress-top')).toBe('100px');
      expect(anchor?.style.getPropertyValue('--longpress-height')).toBe('48px');
      expect(anchor?.querySelector('.mob-longpress-label')?.getAttribute('style')).toBeNull();
      await button.trigger('pointerup');
      w.unmount();
      vi.restoreAllMocks();
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

  it('PhoneRow puts a number in the lead (a point of a star identification)', () => {
    const w = mount(PhoneRow, { props: { title: 'Deneb', number: 2 }, global });
    expect(w.find('.mob-row-lead').text()).toBe('2');
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

  it('PhoneSheet is Ionic sheet with breakpoints 0 and 1, whose drag down nothing holds back', async () => {
    const w = mount(PhoneSheet, { props: { open: true, title: 'x' }, global });
    const modal = w.find('.mob-sheet-modal');
    // The content's height is breakpoint 1; dropping below it dismisses the modal (Ionic's own gesture).
    expect(modal.attributes('breakpoints')).toBe('0,1');
    expect(modal.attributes('initial-breakpoint')).toBe('1');
    expect(modal.attributes('handle')).toBe('false');
    // A `canDismiss` makes Ionic's drag down a spring that lags behind the finger and bounces back before closing.
    expect(modal.attributes('can-dismiss')).toBeUndefined();
    // The body is a scroll host: Ionic lets it scroll before it lets the sheet move.
    expect(w.find('.mob-sheet-body').classes()).toContain('ion-content-scroll-host');
    await modal.trigger('did-dismiss');
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('PhoneSheet third keeps its content mounted and opens once it has measured its stops', async () => {
    const restore = portrait();
    const w = mount(PhoneSheet, { props: { open: false, title: 'x', third: true }, global });
    const modal = () => w.find('.mob-sheet-modal');
    expect(modal().attributes('keep-contents-mounted')).toBe('true');
    expect(modal().attributes('expand-to-scroll')).toBe('false');
    expect(w.find('.mob-sheet-room').exists()).toBe(true);
    await w.setProps({ open: true });
    expect(modal().attributes('is-open')).toBe('false');
    await nextTick();
    await nextTick();
    expect(modal().attributes('is-open')).toBe('true');
    restore();
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

  it('PhoneNativePicker holds a hidden input of its type, passes on the picked value and says when it is emptied', () => {
    const w = mount(PhoneNativePicker, { props: { type: 'time', value: '21:30' }, global });
    const input = w.find('input');
    expect(input.attributes('type')).toBe('time');
    expect(input.attributes('aria-hidden')).toBe('true');
    expect(w.classes()).toContain('mob-picker-inputs');
    const stub = w.findComponent(ionicStubs.IonInput);
    stub.vm.$emit('ionChange', { detail: { value: '22:15' } });
    stub.vm.$emit('ionChange', { detail: { value: '' } });
    expect(w.emitted('pick')).toEqual([['22:15']]);
    expect(w.emitted('clear')).toHaveLength(1);
  });
});

describe('the back arrow', () => {
  it("is drawn as Android's (design system revision 20), not as an outlined icon button", () => {
    const w = mount(PhoneBackButton, {
      global: { stubs: ionicStubs, provide: { router: {} } },
    });
    const button = w.find('[aria-label="Retour"]');
    expect(button.classes()).toEqual(expect.arrayContaining(['mob-icon-btn', 'mob-back-btn']));
  });
});

describe('the map sheets', () => {
  it('refuses to draw a map sheet outside a PhoneMapSheetHost (it would neither slide in nor out)', () => {
    const errors = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      mount(PhoneMapSheet, { props: { title: 'M31' }, global: { stubs: ionicStubs } }),
    ).toThrow(/PhoneMapSheetHost/);
    errors.mockRestore();
  });

  // Each page is attached to the document (the modal is found by its id there) and removed after its test.
  const pages: { unmount: () => void }[] = [];
  afterEach(() => pages.splice(0).forEach((w) => w.unmount()));

  /** A page drawing one map sheet in its host; `shown` is whether the page is on screen. */
  function page(shown = ref(true), drawn = ref(true), collapsed = ref(false)) {
    const Page = defineComponent({
      setup: () => () =>
        h(
          PhoneMapSheetHost,
          { shown: shown.value },
          {
            default: () =>
              drawn.value
                ? h(PhoneMapSheet, { title: 'M31', collapsed: collapsed.value }, () =>
                    h('p', 'Contenu'),
                  )
                : null,
          },
        ),
    });
    const w = mount(Page, {
      global: { stubs: { ...ionicStubs, transition: false } },
      attachTo: document.body,
    });
    pages.push(w);
    return w;
  }

  it("is Ionic's sheet modal with no scrim, so the map around it can still be touched", () => {
    const modal = page().find('.mob-sheet-modal--map');
    expect(modal.attributes('show-backdrop')).toBe('false');
    expect(modal.attributes('backdrop-dismiss')).toBe('false');
    expect(modal.attributes('focus-trap')).toBe('false');
    expect(modal.attributes('handle')).toBe('false');
    expect(modal.attributes('keep-contents-mounted')).toBeDefined();
    expect(modal.attributes('can-dismiss')).toBeUndefined();
  });

  it('opens only while its page is on screen', async () => {
    const shown = ref(false);
    const w = page(shown);
    const isOpen = () => w.find('.mob-sheet-modal--map').attributes('is-open');
    await nextTick();
    expect(isOpen()).toBe('false');
    shown.value = true;
    await new Promise((r) => setTimeout(r));
    await nextTick();
    expect(isOpen()).toBe('true');
    shown.value = false;
    await nextTick();
    expect(isOpen()).toBe('false');
  });

  it('puts its content in a body that scrolls under the handle and the title, hidden when collapsed', async () => {
    const collapsed = ref(false);
    const w = page(ref(true), ref(true), collapsed);
    expect(w.find('.mob-sheet-title').text()).toBe('M31');
    const body = w.find('.mob-map-sheet > .mob-sheet-body.mob-scroll');
    expect(body.text()).toBe('Contenu');
    expect(body.classes()).toContain('ion-content-scroll-host');
    collapsed.value = true;
    await nextTick();
    expect(body.attributes('style')).toContain('display: none');
    expect(w.find('.mob-sheet-title').isVisible()).toBe(true);
  });

  it('closes from its handle and from a drag down, not when its page closes it', async () => {
    const w = page();
    const sheet = () => w.findComponent(PhoneMapSheet);
    await w.find('.mob-sheet-grab').trigger('click');
    expect(sheet().emitted('close')).toHaveLength(1);
    const modal = w.findComponent(ionicStubs.IonModal);
    modal.vm.$emit('didDismiss', { detail: {} });
    expect(sheet().emitted('close')).toHaveLength(1);
    modal.vm.$emit('didDismiss', { detail: { role: 'gesture' } });
    expect(sheet().emitted('close')).toHaveLength(2);
  });

  it('is slid out by Ionic when the page removes it', async () => {
    const drawn = ref(true);
    const w = page(ref(true), drawn);
    // The modal, found by the id its room names, is open: Ionic slides it out.
    const id = w.find('.mob-map-sheet-room').attributes('data-modal')!;
    const modal = document.getElementById(id)!;
    modal.classList.add('show-modal');
    let finish = () => {};
    const dismiss = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    Object.assign(modal, { dismiss });
    drawn.value = false;
    await nextTick();
    expect(dismiss).toHaveBeenCalled();
    // Vue keeps the sheet until Ionic has slid it out
    expect(document.getElementById(id)).not.toBeNull();
    finish();
    await new Promise((r) => setTimeout(r));
    await nextTick();
    expect(document.getElementById(id)).toBeNull();
  });
});

describe('the stops of a sheet', () => {
  it('opens a sheet at its content height when it fits in a third, or when it is not held to a third', () => {
    expect(sheetStops(200, 900, true)).toEqual({
      breakpoints: [0, 1],
      initial: 1,
      height: null,
      max: 300,
      opens: 200,
    });
    expect(sheetStops(800, 900, false)).toEqual({
      breakpoints: [0, 1],
      initial: 1,
      height: null,
      max: 900,
      opens: 800,
    });
  });

  it('opens a taller sheet at a third, its top stop at two thirds or at its content height', () => {
    expect(sheetStops(800, 900, true)).toEqual({
      breakpoints: [0, 0.5, 1],
      initial: 0.5,
      height: 600,
      max: 600,
      opens: 300,
    });
    expect(sheetStops(400, 900, true)).toEqual({
      breakpoints: [0, 0.75, 1],
      initial: 0.75,
      height: 400,
      max: 400,
      opens: 300,
    });
  });

  it('counts the strip under a sheet that ends above the bottom of the screen', () => {
    // 100 px under: at the third the 700 px modal shows 400 px, the sheet's 300 and the strip
    const stops = sheetStops(800, 900, true, 100);
    expect(stops.height).toBe(700);
    expect(stops.max).toBe(600);
    expect(stops.opens).toBe(300);
    expect(stops.breakpoints[1]).toBeCloseTo(400 / 700);
  });

  it('stops where the content marks it, then shows the whole content, opening at the first mark', () => {
    const stops = contentStops(500, 700, [380, 260], 100);
    // the modal is the 500 px sheet and the 100 px strip; the marks sorted, each with the strip under it
    expect(stops.height).toBe(600);
    expect(stops.breakpoints).toEqual([0, 360 / 600, 480 / 600, 1]);
    expect(stops.initial).toBe(360 / 600);
    expect(stops.opens).toBe(260);
  });

  it('shows at most the room, and leaves out the marks past it', () => {
    const stops = contentStops(900, 400, [260, 520]);
    expect(stops.height).toBe(400);
    expect(stops.max).toBe(400);
    expect(stops.breakpoints).toEqual([0, 260 / 400, 1]);
    // no mark left: the sheet opens whole
    expect(contentStops(300, 700, [300, 520])).toMatchObject({ breakpoints: [0, 1], height: null });
  });

  it('reads the marks of a content: under the line of a fact, above a row', () => {
    const sheet = document.createElement('section');
    sheet.innerHTML = `<div class="facts"><div id="a"></div><div id="eq" data-sheet-stop></div><div id="c"></div></div>
      <div id="row" data-sheet-stop="before"></div>`;
    const boxes: Record<string, [number, number]> = {
      a: [200, 240],
      eq: [200, 230],
      c: [250, 290],
      row: [330, 378],
    };
    for (const el of sheet.querySelectorAll<HTMLElement>('[id]')) {
      const [top, bottom] = boxes[el.id];
      el.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
    }
    sheet.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
    // the equipment's line ends with its tallest neighbour (240), the row starts at 330
    expect(sheetMarks(sheet)).toEqual([140, 230]);
  });
});

describe('the stops of a sheet without marks', () => {
  it('moves a third that would cut a row up to the end of the last row it holds whole', () => {
    expect(underLastRow(300, [120, 250, 330])).toBe(250);
    // a row ending exactly there is held whole
    expect(underLastRow(250, [120, 250, 330])).toBe(250);
    // no row ends before it: it stays
    expect(underLastRow(100, [120, 250])).toBe(100);
  });

  it("reads where the body's rows end, and the lines of a list inside one", () => {
    const sheet = document.createElement('section');
    sheet.innerHTML = `<div class="mob-sheet-body"><div id="facts"><div id="f1"></div><div id="f2"></div></div><div id="row"></div></div>`;
    const bottoms: Record<string, number> = { facts: 260, f1: 200, f2: 260, row: 320 };
    for (const el of sheet.querySelectorAll<HTMLElement>('[id]')) {
      el.getBoundingClientRect = () => ({ bottom: bottoms[el.id] }) as DOMRect;
    }
    sheet.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    expect(sheetRows(sheet)).toEqual([100, 160, 160, 220]);
  });
});

describe('the photo facts', () => {
  it('mark the equipment as where a map sheet first stops', () => {
    const w = mount(PhoneFacts, {
      props: {
        facts: [
          { label: 'Date', value: '1 mars' },
          { label: 'Équipement', value: 'Vespera', stop: true },
        ],
      },
      global,
    });
    const facts = w.findAll('.mob-fact');
    expect(facts[0].attributes('data-sheet-stop')).toBeUndefined();
    expect(facts[1].attributes('data-sheet-stop')).toBe('');
  });
});

/** Makes the window portrait (or landscape) for `(orientation: landscape)`; returns the undo. */
function portrait(isPortrait = true) {
  const media = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('landscape') ? !isPortrait : false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return () => (window.matchMedia = media);
}
