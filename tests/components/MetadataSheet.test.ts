/**
 * Tests for the gallery's photo information panel: InlineEditRow (text + pen → field + ✓ ✕, Enter / Esc),
 * DateTimePicker (month grid + time) and MetadataSheet (each change saved at once through `save`, the "+" of each
 * section, the object list folded to three lines).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { defineComponent, h, reactive, provide } from 'vue';
import type { Photo } from '@myastrosky/core/types';
import type { PhotoMetadataDraft } from '@myastrosky/core/photo-metadata-draft';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../src/toast', () => ({ showToast }));
vi.mock('../../src/ui', () => ({
  triggerAsteroidModal: vi.fn(),
  triggerSupernovaModal: vi.fn(),
  triggerCometModal: vi.fn(),
  triggerPoiAddModal: vi.fn(),
}));
vi.mock('@myastrosky/core/search', () => ({
  searchDSOs: (q: string) =>
    q.toLowerCase().startsWith('ngc')
      ? [
          { dso: { id: 'NGC4606', displayName: '' } },
          { dso: { id: 'NGC4631', displayName: 'Galaxie de la Baleine' } },
        ]
      : [],
}));

import InlineEditRow, { EDIT_TRACKER_KEY } from '../../src/components/base/InlineEditRow.vue';
import DateTimePicker from '../../src/components/base/DateTimePicker.vue';
import MetadataSheet from '../../src/components/modals/MetadataSheet.vue';
import { triggerPoiAddModal } from '../../src/ui';
import { t } from '../../src/i18n';

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── InlineEditRow ────────────────────────────────────────────────────────────
describe('InlineEditRow', () => {
  function mountRow(
    props: Record<string, unknown> = {},
    tracker?: { change: (d: 1 | -1) => void },
  ) {
    const Host = defineComponent({
      setup() {
        if (tracker) provide(EDIT_TRACKER_KEY, tracker);
        return () =>
          h(
            InlineEditRow,
            { label: 'Gain', save: () => true, ...props },
            {
              default: () => '100',
              editor: () => h('input', { 'data-test': 'editor-input' }),
            },
          );
      },
    });
    return mount(Host, { attachTo: document.body });
  }

  it('reads as label and value, and opens the field with the pen', async () => {
    const onOpen = vi.fn();
    const w = mountRow({ onOpen });
    expect(w.text()).toContain('Gain');
    expect(w.text()).toContain('100');
    expect(w.find('[data-test=editor-input]').exists()).toBe(false);
    await w.find('[data-test=row-edit]').trigger('click');
    expect(onOpen).toHaveBeenCalled();
    expect(w.find('[data-test=editor-input]').exists()).toBe(true);
    expect(w.find('[data-test=row-ok]').exists()).toBe(true);
    expect(w.find('[data-test=row-remove]').exists()).toBe(false);
    w.unmount();
  });

  it('closes once saved, and stays open with the value when the save fails', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const w = mountRow({ save });
    await w.find('[data-test=row-edit]').trigger('click');
    await w.find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test=editor-input]').exists()).toBe(true);
    await w.find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test=editor-input]').exists()).toBe(false);
    w.unmount();
  });

  it('confirms with Enter and gives up with Esc, without the Esc reaching the page', async () => {
    const save = vi.fn(() => true);
    const onCancel = vi.fn();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    const w = mountRow({ save, onCancel });

    await w.find('[data-test=row-edit]').trigger('click');
    await w.find('[data-test=editor-input]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(save).toHaveBeenCalledOnce();

    await w.find('[data-test=row-edit]').trigger('click');
    await w.find('[data-test=editor-input]').trigger('keydown', { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(w.find('[data-test=editor-input]').exists()).toBe(false);
    expect(pageKeys.mock.calls.map(([e]) => (e as KeyboardEvent).key)).not.toContain('Escape');
    document.removeEventListener('keydown', pageKeys);
    w.unmount();
  });

  it('opens already in editing when asked, with a bin when the field can be removed', () => {
    const onRemove = vi.fn();
    const w = mountRow({ startOpen: true, removable: true, onRemove });
    expect(w.find('[data-test=editor-input]').exists()).toBe(true);
    void w.find('[data-test=row-remove]').trigger('click');
    expect(onRemove).toHaveBeenCalledOnce();
    w.unmount();
  });

  it('tells the panel how many lines are being edited', async () => {
    const change = vi.fn();
    const w = mountRow({}, { change });
    await w.find('[data-test=row-edit]').trigger('click');
    expect(change).toHaveBeenLastCalledWith(1);
    await w.find('[data-test=row-cancel]').trigger('click');
    expect(change).toHaveBeenLastCalledWith(-1);
    w.unmount();
  });
});

// ─── DateTimePicker ───────────────────────────────────────────────────────────
describe('DateTimePicker', () => {
  it('opens on the month of the date, with its day and time chosen', () => {
    const w = mount(DateTimePicker, { props: { value: '2025-10-12T22:40' } });
    const pressed = w
      .findAll('[data-test=day]')
      .filter((d) => d.attributes('aria-pressed') === 'true');
    expect(pressed.map((d) => d.text())).toEqual(['12']);
    expect((w.find('[data-test=hour]').element as HTMLSelectElement).value).toBe('22');
    expect((w.find('[data-test=minute]').element as HTMLSelectElement).value).toBe('40');
    expect(w.find('[data-test=month-title]').text()).toContain('2025');
  });

  it('gives the day and time chosen', async () => {
    const w = mount(DateTimePicker, { props: { value: '2025-10-12T22:40' } });
    const day3 = w.findAll('[data-test=day]').find((d) => d.text() === '3')!;
    await day3.trigger('click');
    await w.find('[data-test=hour]').setValue('1');
    await w.find('[data-test=date-ok]').trigger('click');
    expect(w.emitted('confirm')![0]).toEqual(['2025-10-03T01:40']);
  });

  it('moves between months', async () => {
    const w = mount(DateTimePicker, { props: { value: '2025-12-31T00:00' } });
    const before = w.find('[data-test=month-title]').text();
    await w.find('[data-test=next-month]').trigger('click');
    expect(w.find('[data-test=month-title]').text()).toContain('2026');
    await w.find('[data-test=prev-month]').trigger('click');
    expect(w.find('[data-test=month-title]').text()).toBe(before);
  });

  it('cannot confirm before a day is chosen', async () => {
    const w = mount(DateTimePicker, { props: { value: '' } });
    expect(w.find('[data-test=date-ok]').attributes('disabled')).toBeDefined();
    await w.find('[data-test=date-cancel]').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
  });
});

// ─── MetadataSheet ────────────────────────────────────────────────────────────
const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M31',
    width: 4000,
    height: 2000,
    dsoIds: [],
    labels: [],
    ...over,
  }) as unknown as Photo;

function draftOf(over: Partial<PhotoMetadataDraft> = {}): PhotoMetadataDraft {
  return reactive({
    displayName: 'M31',
    dsoIds: ['M32', 'M31'],
    labels: ['Automne 2025'],
    pointsOfInterest: [],
    integrations: [
      { frames: 120, seconds: 180, filter: 'Ha' },
      { frames: 80, seconds: 180, filter: 'OIII' },
    ],
    observationDate: new Date(2025, 9, 12, 22, 40).toISOString(),
    captureDetails: { gain: 100, ccdTemp: -10 },
    gearSetupId: 's1',
    notes: 'Bon seeing',
    ...over,
  }) as PhotoMetadataDraft;
}

describe('MetadataSheet', () => {
  let draft: PhotoMetadataDraft;
  let save: ReturnType<typeof vi.fn>;
  let wrapper: VueWrapper;

  function mountSheet(over: Partial<PhotoMetadataDraft> = {}, p = photo()) {
    draft = draftOf(over);
    // Saves like the editor does: the draft takes the change once saved.
    save = vi.fn(async (patch: Partial<PhotoMetadataDraft>) => {
      Object.assign(draft, patch);
      return true;
    });
    wrapper = mount(MetadataSheet, {
      attachTo: document.body,
      props: {
        draft,
        gearSetups: [{ id: 's1', name: 'RedCat 51 + ASI2600MC' }] as never,
        knownFilterMap: new Map([['ha', 'Ha']]),
        knownLabels: ['Seeing moyen'],
        photo: p,
        save,
      },
      global: { plugins: [createTestingPinia({ createSpy: vi.fn })] },
    });
    return wrapper;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => wrapper?.unmount());

  const row = (test: string) => wrapper.find(`[data-test=${test}]`);

  it('reads every fact as text, without any field open', () => {
    mountSheet();
    expect(wrapper.findAll('input, textarea, select')).toHaveLength(0);
    expect(row('row-date').text()).toContain('2025');
    expect(row('row-date').text()).toMatch(/22:40|10:40/);
    // The time first, then the filter, which takes the rest of the line.
    const exposures = wrapper.findAll('[data-test=row-exposure]');
    expect(exposures.map((r) => r.text())).toEqual(['120 × 180s = 6h00Ha', '80 × 180s = 4h00OIII']);
    expect(exposures[0].find('.sheet-label').exists()).toBe(false);
    expect(row('row-total').text()).toContain('10h00');
    expect(row('row-setup').text()).toContain('RedCat 51 + ASI2600MC');
    expect(row('row-capture-gain').text()).toContain('100');
    expect(row('row-capture-ccdTemp').text()).toContain('-10 °C');
    expect(row('row-notes').text()).toContain('Bon seeing');
    // The objects, the most important catalogue first.
    expect(wrapper.find('[data-test=object-chips]').text()).toMatch(/M31.*M32/s);
  });

  it('orders the sections: exposures with the equipment, capture details just above the notes', () => {
    mountSheet();
    const sections = wrapper.findAll('section').map((s) => s.attributes('data-test'));
    expect(sections).toEqual([
      'sheet-objects',
      'sheet-acquisition',
      'sheet-gear',
      'sheet-pois',
      'sheet-labels',
      'sheet-capture',
      'sheet-notes',
    ]);
    const gear = wrapper.find('[data-test=sheet-gear]');
    expect(gear.find('[data-test=row-setup]').exists()).toBe(true);
    expect(gear.findAll('[data-test=row-exposure]')).toHaveLength(2);
    expect(gear.find('[data-test=row-total]').exists()).toBe(true);
    expect(gear.find('[data-test=add-exposure]').exists()).toBe(true);
    const acquisition = wrapper.find('[data-test=sheet-acquisition]');
    expect(acquisition.find('[data-test=row-date]').exists()).toBe(true);
    expect(acquisition.find('[data-test=row-exposure]').exists()).toBe(false);
    const capture = wrapper.find('[data-test=sheet-capture]');
    expect(capture.text()).toContain(t('modal.metadataCapture'));
    expect(capture.find('[data-test=add-capture]').exists()).toBe(true);
    expect(capture.find('[data-test=row-capture-gain]').exists()).toBe(true);
  });

  it('says what is missing on a photo without information', () => {
    mountSheet({
      dsoIds: [],
      labels: [],
      integrations: [],
      observationDate: '',
      captureDetails: {},
      gearSetupId: null,
      notes: '',
    });
    expect(row('row-date').text()).toContain(t('gallery.sheet.dateNotSet'));
    expect(row('row-setup').text()).toContain(t('gallery.sheet.noSetup'));
    expect(row('row-notes').text()).toContain(t('gallery.sheet.noNotes'));
    expect(row('row-total').exists()).toBe(false);
    expect(wrapper.find('[data-test=object-chips]').exists()).toBe(false);
  });

  it('changes a capture detail and saves it at once', async () => {
    mountSheet();
    await row('row-capture-gain').find('[data-test=row-edit]').trigger('click');
    const input = row('row-capture-gain').find('[data-test=capture-input]');
    expect((input.element as HTMLInputElement).value).toBe('100');
    await input.setValue('120');
    await row('row-capture-gain').find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ captureDetails: { gain: 120, ccdTemp: -10 } });
    expect(row('row-capture-gain').find('input').exists()).toBe(false);
    expect(row('row-capture-gain').text()).toContain('120');
  });

  it('refuses an empty capture detail and says so', async () => {
    mountSheet();
    await row('row-capture-gain').find('[data-test=row-edit]').trigger('click');
    await row('row-capture-gain').find('[data-test=capture-input]').setValue('');
    await row('row-capture-gain').find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0].message).toBe(t('gallery.sheet.emptyCapture'));
  });

  it('removes a capture detail with its bin', async () => {
    mountSheet();
    await row('row-capture-ccdTemp').find('[data-test=row-edit]').trigger('click');
    await row('row-capture-ccdTemp').find('[data-test=row-remove]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ captureDetails: { gain: 100 } });
  });

  it('adds a capture detail from the "+" menu, which lists only the missing ones', async () => {
    mountSheet();
    await wrapper.find('[data-test=add-capture]').trigger('click');
    const items = wrapper.findAll('[data-test=capture-menu] button').map((b) => b.text());
    expect(items).not.toContain(t('modal.metadataCaptureGain'));
    expect(items).toContain(t('modal.metadataCaptureIso'));
    const iso = wrapper
      .findAll('[data-test=capture-menu] button')
      .find((b) => b.text() === t('modal.metadataCaptureIso'))!;
    await iso.trigger('click');
    expect(wrapper.find('[data-test=capture-menu]').exists()).toBe(false);
    // The new line opens directly; ✕ takes it away again.
    const isoRow = row('row-capture-iso');
    expect(isoRow.find('[data-test=capture-input]').exists()).toBe(true);
    await isoRow.find('[data-test=row-cancel]').trigger('click');
    expect(row('row-capture-iso').exists()).toBe(false);
    expect(save).not.toHaveBeenCalled();

    await wrapper.find('[data-test=add-capture]').trigger('click');
    await wrapper
      .findAll('[data-test=capture-menu] button')
      .find((b) => b.text() === t('modal.metadataCaptureIso'))!
      .trigger('click');
    await row('row-capture-iso').find('[data-test=capture-input]').setValue('800');
    await row('row-capture-iso')
      .find('[data-test=capture-input]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ captureDetails: { gain: 100, ccdTemp: -10, iso: 800 } });
  });

  it('adds an exposure row with "+", refusing it without a count or a length', async () => {
    mountSheet();
    await wrapper.find('[data-test=add-exposure]').trigger('click');
    const rows = () => wrapper.findAll('[data-test=row-exposure]');
    expect(rows()).toHaveLength(3);
    const fresh = rows()[2];
    await fresh.find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0].message).toBe(t('errors.integrationRowIncomplete'));

    await fresh.find('[data-test=exposure-frames]').setValue('30');
    await fresh.find('[data-test=exposure-seconds]').setValue('60');
    await fresh.find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({
      integrations: [
        { frames: 120, seconds: 180, filter: 'Ha' },
        { frames: 80, seconds: 180, filter: 'OIII' },
        { frames: 30, seconds: 60, filter: '' },
      ],
    });
    expect(rows()).toHaveLength(3);
    expect(rows()[2].find('input').exists()).toBe(false);
  });

  it('changes and removes an exposure row', async () => {
    mountSheet();
    const first = () => wrapper.findAll('[data-test=row-exposure]')[0];
    await first().find('[data-test=row-edit]').trigger('click');
    await first().find('[data-test=exposure-frames]').setValue('150');
    await first().find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save.mock.calls[0][0].integrations[0]).toEqual({
      frames: 150,
      seconds: 180,
      filter: 'Ha',
    });

    await first().find('[data-test=row-edit]').trigger('click');
    await first().find('[data-test=row-remove]').trigger('click');
    await flushPromises();
    expect(save.mock.calls[1][0]).toEqual({
      integrations: [{ frames: 80, seconds: 180, filter: 'OIII' }],
    });
  });

  it('chooses the date in the calendar and saves it', async () => {
    mountSheet();
    await row('row-date').find('[data-test=row-edit]').trigger('click');
    const picker = wrapper.find('[data-test=date-picker]');
    expect(picker.exists()).toBe(true);
    await picker
      .findAll('[data-test=day]')
      .find((d) => d.text() === '13')!
      .trigger('click');
    await picker.find('[data-test=date-ok]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({
      observationDate: new Date(2025, 9, 13, 22, 40).toISOString(),
    });
    expect(wrapper.find('[data-test=date-picker]').exists()).toBe(false);
  });

  it('changes the equipment and the notes', async () => {
    mountSheet();
    await row('row-setup').find('[data-test=row-edit]').trigger('click');
    await row('row-setup').find('[data-test=setup-select]').setValue('');
    await row('row-setup').find('[data-test=row-ok]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ gearSetupId: null });

    await row('row-notes').find('[data-test=row-edit]').trigger('click');
    const notes = row('row-notes').find('[data-test=notes-input]');
    await notes.setValue('Vent après minuit');
    // Enter makes a new line in the notes; Ctrl+Enter confirms.
    await notes.trigger('keydown', { key: 'Enter' });
    expect(save).toHaveBeenCalledTimes(1);
    await notes.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ notes: 'Vent après minuit' });
  });

  it('adds objects from the search field opened with "+", which stays open for the next one', async () => {
    vi.useFakeTimers();
    mountSheet();
    expect(wrapper.find('[data-test=object-search]').exists()).toBe(false);
    await wrapper.find('[data-test=add-object]').trigger('click');
    const input = wrapper.find('[data-test=object-search]');
    await input.setValue('ngc 46');
    vi.advanceTimersByTime(250);
    await flushPromises();
    const suggestions = wrapper.findAll('[data-test=object-suggestion]');
    expect(suggestions.map((s) => s.text())).toEqual([
      'NGC4606',
      'NGC4631 — Galaxie de la Baleine',
    ]);
    await suggestions[1].trigger('mousedown');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ dsoIds: ['M32', 'M31', 'NGC4631'] });
    expect(wrapper.find('[data-test=object-search]').exists()).toBe(true);
    expect((wrapper.find('[data-test=object-search]').element as HTMLInputElement).value).toBe('');
    // Esc closes the field.
    await wrapper.find('[data-test=object-search]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-test=object-search]').exists()).toBe(false);
    vi.useRealTimers();
  });

  it('removes an object with the × of its chip', async () => {
    mountSheet();
    const m32 = wrapper
      .findAll('[data-test=object-chips] .tag-chip')
      .find((c) => c.text().startsWith('M32'))!;
    await m32.find('button').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ dsoIds: ['M31'] });
  });

  it('adds a label typed or picked, and removes one', async () => {
    mountSheet();
    await wrapper.find('[data-test=add-label]').trigger('click');
    expect(wrapper.findAll('[data-test=label-suggestion]').map((s) => s.text())).toEqual([
      'Seeing moyen',
    ]);
    const input = wrapper.find('[data-test=label-input]');
    await input.setValue('Lune');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ labels: ['Automne 2025', 'Lune'] });

    await wrapper.find('[data-test=label-suggestion]').trigger('mousedown');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ labels: ['Automne 2025', 'Lune', 'Seeing moyen'] });

    const chip = wrapper.findAll('[data-test=label-chips] .tag-chip')[0];
    await chip.find('button').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ labels: ['Lune', 'Seeing moyen'] });
  });

  it('greys out adding a point of interest on a photo not placed yet', async () => {
    mountSheet();
    await wrapper.find('[data-test=add-poi]').trigger('click');
    const items = wrapper.findAll('[data-test=poi-menu] button');
    expect(items).toHaveLength(1);
    expect(items[0].attributes('disabled')).toBeDefined();
    expect(items[0].attributes('title')).toBe(t('poi.addNeedsSolve'));
  });

  it('saves the points of interest added from the dialog', async () => {
    const solved = photo({
      manualPlacement: {
        centerRa: 10,
        centerDec: 41,
        rotationDeg: 0,
        projPerPx: 1e-5,
        mirrorX: false,
        mirrorY: false,
      },
    });
    mountSheet({}, solved);
    await wrapper.find('[data-test=add-poi]').trigger('click');
    const items = wrapper.findAll('[data-test=poi-menu] button');
    expect(items).toHaveLength(4);
    await items[0].trigger('click');
    const onIdentified = vi.mocked(triggerPoiAddModal).mock.calls[0][1];
    const poi = { name: 'C/2025 A1', categoryId: 'comet' };
    onIdentified(solved, [poi as never]);
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ pointsOfInterest: [poi] });
    expect(wrapper.find('[data-test=poi-chips]').text()).toContain('C/2025 A1');
  });

  describe('folding sections', () => {
    const section = (name: string) => wrapper.find(`[data-test=${name}]`);
    const body = (name: string) => section(name).find('[data-test=section-body]');
    const toggle = (name: string) => section(name).find('[data-test=section-toggle]');

    it('opens every section at first, and folds one from its title', async () => {
      mountSheet();
      expect(toggle('sheet-capture').attributes('aria-expanded')).toBe('true');
      expect(body('sheet-capture').isVisible()).toBe(true);
      await toggle('sheet-capture').trigger('click');
      expect(toggle('sheet-capture').attributes('aria-expanded')).toBe('false');
      expect(body('sheet-capture').isVisible()).toBe(false);
      await toggle('sheet-capture').trigger('click');
      expect(body('sheet-capture').isVisible()).toBe(true);
    });

    it('says what a folded section holds beside its title', async () => {
      mountSheet();
      for (const name of [
        'sheet-objects',
        'sheet-gear',
        'sheet-labels',
        'sheet-capture',
        'sheet-notes',
      ]) {
        expect(section(name).find('[data-test=section-summary]').exists()).toBe(false);
        await toggle(name).trigger('click');
      }
      const summary = (name: string) => section(name).find('[data-test=section-summary]').text();
      expect(summary('sheet-objects')).toBe('· 2');
      expect(summary('sheet-gear')).toBe('· RedCat 51 + ASI2600MC · 10h00');
      expect(summary('sheet-labels')).toBe('· Automne 2025');
      expect(summary('sheet-capture')).toBe('· 2');
      expect(summary('sheet-notes')).toBe('· Bon seeing');
    });

    it('opens a folded section when its "+" is pressed', async () => {
      mountSheet();
      await toggle('sheet-labels').trigger('click');
      await wrapper.find('[data-test=add-label]').trigger('click');
      expect(body('sheet-labels').isVisible()).toBe(true);
      expect(wrapper.find('[data-test=label-input]').exists()).toBe(true);

      await toggle('sheet-gear').trigger('click');
      await wrapper.find('[data-test=add-exposure]').trigger('click');
      expect(body('sheet-gear').isVisible()).toBe(true);
      expect(wrapper.findAll('[data-test=row-exposure]')).toHaveLength(3);
    });

    it('remembers the folded sections for the next photo', async () => {
      mountSheet();
      await toggle('sheet-capture').trigger('click');
      await toggle('sheet-notes').trigger('click');
      wrapper.unmount();
      mountSheet();
      expect(body('sheet-capture').isVisible()).toBe(false);
      expect(body('sheet-notes').isVisible()).toBe(false);
      expect(body('sheet-gear').isVisible()).toBe(true);
    });

    it('still folds when the browser storage cannot be used', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      mountSheet();
      await toggle('sheet-capture').trigger('click');
      expect(body('sheet-capture').isVisible()).toBe(false);
      getItem.mockRestore();
      setItem.mockRestore();
    });
  });

  it('tells how many lines are being edited', async () => {
    mountSheet();
    await row('row-capture-gain').find('[data-test=row-edit]').trigger('click');
    await row('row-notes').find('[data-test=row-edit]').trigger('click');
    expect(wrapper.emitted('editing')!.at(-1)).toEqual([2]);
    await row('row-notes').find('[data-test=row-cancel]').trigger('click');
    expect(wrapper.emitted('editing')!.at(-1)).toEqual([1]);
  });
});
