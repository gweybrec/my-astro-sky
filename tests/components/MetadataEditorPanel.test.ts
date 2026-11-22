import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MetadataEditorPanel from '../../src/components/modals/MetadataEditorPanel.vue';
import type { PhotoIntegration } from '@myastrosky/core/types';
import { t } from '../../src/i18n';

const showToast = vi.fn();
vi.mock('../../src/toast', () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

const categories = [
  { id: 'cat-a', name: 'Galaxy', color: '#f00', position: 0 },
  { id: 'cat-b', name: 'Nebula', color: '#0f0', position: 1 },
];

function makeWrapper(integrations: PhotoIntegration[] = []) {
  return mount(MetadataEditorPanel, {
    props: {
      dsoIds: [],
      labels: [],
      pointsOfInterest: [],
      integrations,
      observationDate: '',
      captureDetails: {},
      gearSetupId: null,
      gearSetups: [],
      notes: '',
      displayName: '',
      knownFilterMap: new Map<string, string>(),
      knownLabels: [],
    },
    global: {
      plugins: [
        createTestingPinia({
          stubActions: true,
          createSpy: vi.fn,
          initialState: { poiCategories: { categories, loaded: true } },
        }),
      ],
    },
  });
}

function lastIntegrations(wrapper: ReturnType<typeof makeWrapper>): PhotoIntegration[] | undefined {
  const ev = wrapper.emitted('update:integrations');
  return ev ? (ev[ev.length - 1][0] as PhotoIntegration[]) : undefined;
}

describe('MetadataEditorPanel sections', () => {
  const labels = (w: ReturnType<typeof mount>) => w.findAll('.metadata-label').map((l) => l.text());

  function mountFields(fields?: 'top' | 'rest') {
    const w = makeWrapper([]);
    return fields ? w.setProps({ fields }).then(() => w) : Promise.resolve(w);
  }

  it("follows the gallery's photo panel: objects, acquisition, equipment and exposures, then the rest", async () => {
    const w = await mountFields();
    const order = labels(w);
    const at = (key: string) => order.indexOf(key);
    expect(at(t('modal.metadataDsos'))).toBeLessThan(at(t('gallery.sheet.sectionAcquisition')));
    expect(at(t('gallery.sheet.sectionAcquisition'))).toBeLessThan(
      at(t('gallery.sheet.sectionGear')),
    );
    expect(at(t('gallery.sheet.sectionGear'))).toBeLessThan(at(t('modal.metadataLabels')));
    expect(at(t('modal.metadataLabels'))).toBeLessThan(at(t('modal.metadataCapture')));
    expect(at(t('modal.metadataCapture'))).toBeLessThan(at(t('modal.metadataNotes')));
    // The equipment comes first in its section, above the exposure rows.
    const gear = w.findAll('.metadata-field').find((f) => f.find('.integration-rows').exists())!;
    expect(gear.find('select').exists()).toBe(true);
  });

  it('shows the equipment alone at the top of "Ajouter des photos", the exposures with the rest', async () => {
    const top = await mountFields('top');
    expect(labels(top)).toEqual([t('modal.metadataGearSetup'), t('modal.metadataLabels')]);
    expect(top.find('.integration-rows').exists()).toBe(false);

    const rest = await mountFields('rest');
    expect(labels(rest)).toContain(t('gallery.sheet.sectionGear'));
    expect(rest.find('.integration-rows').exists()).toBe(true);
    expect(rest.findAll('select').length).toBe(1); // only "Ajouter un champ" of the capture details
  });
});

describe('MetadataEditorPanel integration rows', () => {
  it('says there is no exposure yet, until a row is added', async () => {
    const wrapper = makeWrapper([]);
    expect(wrapper.find('[data-test="no-integration"]').text()).toBe(
      t('gallery.sheet.noIntegration'),
    );
    await wrapper.find('.integration-add-row').trigger('click');
    expect(wrapper.find('[data-test="no-integration"]').exists()).toBe(false);
  });

  it('adds a row in edit mode', async () => {
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(true);
    expect(lastIntegrations(wrapper)).toEqual([{ frames: 0, seconds: 0, filter: '' }]);
  });

  it('collapses a filled row to a "N × Sec = Total" label on validate, without emitting', async () => {
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');
    await wrapper.find('input.integration-frames-input').setValue('120');
    await wrapper.find('input.integration-seconds-input').setValue('180');

    const emitCount = wrapper.emitted('update:integrations')?.length ?? 0;
    await wrapper.find('.integration-row-validate').trigger('click');

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    expect(wrapper.find('.integration-row').text()).toMatch(/120\s*×\s*180s\s*=\s*6h00/);
    expect(wrapper.emitted('update:integrations')?.length ?? 0).toBe(emitCount);
  });

  it('reopens a collapsed row for editing with its values intact', async () => {
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');
    await wrapper.find('input.integration-frames-input').setValue('120');
    await wrapper.find('input.integration-seconds-input').setValue('180');
    await wrapper.find('.integration-row-validate').trigger('click');

    await wrapper.find('.integration-row-edit').trigger('click');

    const framesInput = wrapper.find('input.integration-frames-input');
    expect(framesInput.exists()).toBe(true);
    expect((framesInput.element as HTMLInputElement).value).toBe('120');
  });

  it('keeps a fully empty row open and toasts an error on validate', async () => {
    showToast.mockClear();
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');

    const emitCount = wrapper.emitted('update:integrations')?.length ?? 0;
    await wrapper.find('.integration-row-validate').trigger('click');

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(true);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(wrapper.emitted('update:integrations')?.length ?? 0).toBe(emitCount);
  });

  it('validates a row with only the frame count and shows "N × N/A" without a total', async () => {
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');
    await wrapper.find('input.integration-frames-input').setValue('300');
    await wrapper.find('.integration-row-validate').trigger('click');

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    const text = wrapper.find('.integration-row').text();
    expect(text).toMatch(/300\s*×\s*N\/A/);
    expect(text).not.toContain('=');
  });

  it('validates a row with only the exposure and shows "N/A × Ns" without a total', async () => {
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');
    await wrapper.find('input.integration-seconds-input').setValue('10');
    await wrapper.find('.integration-row-validate').trigger('click');

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    const text = wrapper.find('.integration-row').text();
    expect(text).toMatch(/N\/A\s*×\s*10s/);
    expect(text).not.toContain('=');
  });

  it('validates a row with only a filter and shows just its badge', async () => {
    showToast.mockClear();
    const wrapper = makeWrapper([]);
    await wrapper.find('.integration-add-row').trigger('click');
    wrapper.findComponent({ name: 'FilterInput' }).vm.$emit('update:modelValue', 'Ha');
    await wrapper.find('.integration-row-validate').trigger('click');

    expect(showToast).not.toHaveBeenCalled();
    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    expect(wrapper.find('.integration-row').text()).toBe('Ha');
    expect(wrapper.find('.integration-row .target-filter-badge').exists()).toBe(true);
  });

  it('mounts a row with only a filter in display mode', () => {
    const wrapper = makeWrapper([{ frames: 0, seconds: 0, filter: 'OIII' }]);
    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
  });

  it('mounts an already-complete row in display mode', () => {
    const wrapper = makeWrapper([{ frames: 10, seconds: 60, filter: 'L' }]);

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    expect(wrapper.find('.integration-row-edit').exists()).toBe(true);
    expect(wrapper.find('.integration-row').text()).toMatch(/10\s*×\s*60s\s*=\s*10min/);
    expect(wrapper.find('.integration-row').text()).toContain('L');
  });

  it('mounts a partially-filled saved row collapsed as "N × N/A"', () => {
    const wrapper = makeWrapper([{ frames: 300, seconds: 0, filter: '' }]);

    expect(wrapper.find('input.integration-frames-input').exists()).toBe(false);
    expect(wrapper.find('.integration-row').text()).toMatch(/300\s*×\s*N\/A/);
    expect(wrapper.find('.integration-row').text()).not.toContain('=');
  });
});
