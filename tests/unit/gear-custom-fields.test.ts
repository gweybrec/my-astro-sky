import { describe, it, expect, beforeEach } from 'vitest';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import { getHiddenGearIds, setHiddenGearIds, visibleGear } from '@myastrosky/core/gear-catalog';
import {
  CUSTOM_GEAR_FIELDS,
  DEFAULT_FILTER_COLOR,
  buildCustomGearData,
  initialCustomGearValues,
  missingCustomGearFields,
} from '@myastrosky/core/gear-custom-fields';
import fr from '@myastrosky/core/i18n/fr';

beforeEach(() => configureStorage(createMemoryStore()));

describe('hidden gear', () => {
  it('is stored per kind; filters keep their existing key', () => {
    setHiddenGearIds('telescope', new Set(['a', 'b']));
    setHiddenGearIds('filter', new Set(['f']));
    expect([...getHiddenGearIds('telescope')]).toEqual(['a', 'b']);
    expect(getHiddenGearIds('camera').size).toBe(0);
    expect(JSON.parse(storage().get('myastrosky-hidden-filter-ids')!)).toEqual(['f']);
  });

  it('reads a damaged value as nothing hidden', () => {
    storage().set('myastrosky-hidden-camera-ids', '{not json');
    expect(getHiddenGearIds('camera').size).toBe(0);
  });

  it('leaves out hidden items but keeps the current choice', () => {
    setHiddenGearIds('accessory', new Set(['x', 'y']));
    const list = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(visibleGear(list, 'accessory').map((g) => g.id)).toEqual(['z']);
    expect(visibleGear(list, 'accessory', 'y').map((g) => g.id)).toEqual(['y', 'z']);
  });
});

describe('custom gear fields', () => {
  it('has a label and a help text for every field, and a label for every choice', () => {
    const gear = fr.targets.gear as unknown as {
      fields: Record<string, unknown> & { help: Record<string, string> };
    };
    for (const fields of Object.values(CUSTOM_GEAR_FIELDS)) {
      for (const f of fields) {
        expect(typeof gear.fields[f.name], f.name).toBe('string');
        expect(typeof gear.fields.help[f.name], f.name).toBe('string');
        for (const o of f.options ?? []) {
          const label = o.labelKey
            .split('.')
            .reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], fr);
          expect(typeof label, o.labelKey).toBe('string');
        }
      }
    }
  });

  it('lists the required fields left empty or not a number', () => {
    const values = { ...initialCustomGearValues('telescope'), brand: 'GSO', model: 'N 200' };
    expect(missingCustomGearFields('telescope', values)).toEqual([
      'aperture_mm',
      'focal_length_mm',
    ]);
    values.aperture_mm = '200';
    values.focal_length_mm = 'abc';
    expect(missingCustomGearFields('telescope', values)).toEqual(['focal_length_mm']);
    values.focal_length_mm = '800,5';
    expect(missingCustomGearFields('telescope', values)).toEqual([]);
  });

  it('builds a telescope record: numbers parsed, empty fields left out, never smart', () => {
    const data = buildCustomGearData('telescope', {
      brand: ' GSO ',
      model: 'Newton 200/800',
      aperture_mm: '200',
      focal_length_mm: '800,5',
      optical_design: '',
    });
    expect(data).toEqual({
      brand: 'GSO',
      model: 'Newton 200/800',
      aperture_mm: 200,
      focal_length_mm: 800.5,
      f_ratio: 4,
      is_smart_telescope: 0,
      integrated_camera: 0,
      integrated_camera_id: null,
      status: 'active',
    });
  });

  it('builds a filter record with its defaults', () => {
    const data = buildCustomGearData('filter', { brand: 'Baader', model: 'Ha 7nm' });
    expect(data).toMatchObject({
      model: 'Ha 7nm',
      astrobin_name: null,
      spcc_name: null,
      type: 'broadband',
      mono_osc: 'both',
      color: DEFAULT_FILTER_COLOR,
    });
  });

  it('starts a camera form on OSC', () => {
    expect(initialCustomGearValues('camera').color_type).toBe('OSC');
  });
});
