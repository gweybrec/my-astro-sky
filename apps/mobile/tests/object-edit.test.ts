import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { DSO, DSOUserOverride } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';

const upsertDsoOverride = vi.fn();
const deleteDsoOverride = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  upsertDsoOverride: (...a: unknown[]) => upsertDsoOverride(...a),
  deleteDsoOverride: (...a: unknown[]) => deleteDsoOverride(...a),
}));

const M31 = {
  id: 'M31',
  catalogs: ['M31', 'NGC224'],
  displayName: "Galaxie d'Andromède",
  type: 'GxS',
  constellation: 'And',
  ra: 10.6847,
  dec: 41.269,
} as unknown as DSO;
const override: { value: DSOUserOverride | undefined } = { value: undefined };
// The catalogue's own values exist once the catalogues are loaded (catalogsReady), as in the app.
const catalogue = vi.hoisted(() => ({ loaded: true }));
const applyAndStoreSingleOverride = vi.fn();
const resetDsoToBaseValues = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  getDSOById: (id: string) => (id === 'M31' ? M31 : undefined),
  getDSOCatalogBaseValues: () =>
    catalogue.loaded
      ? {
          ra: 10.6847,
          dec: 41.269,
          nameFr: "Galaxie d'Andromède",
          nameEn: 'Andromeda Galaxy',
          nameEs: null,
          nameDe: null,
          constellation: 'And',
          rating: 5,
          difficulty: 1,
          type: 'GxS',
        }
      : null,
  getUserOverride: () => override.value,
  applyAndStoreSingleOverride: (...a: unknown[]) => applyAndStoreSingleOverride(...a),
  resetDsoToBaseValues: (...a: unknown[]) => resetDsoToBaseValues(...a),
}));
vi.mock('@myastrosky/core/catalog/star-registry', () => ({
  getConstellationInfos: () => [
    { id: 'Cas', name: 'Cassiopeia', displayName: 'Cassiopée', ra: 0, dec: 0 },
    { id: 'And', name: 'Andromeda', displayName: 'Andromède', ra: 0, dec: 0 },
  ],
}));
vi.mock('../src/catalogs', () => ({
  catalogsReady: () => {
    catalogue.loaded = true;
    return Promise.resolve();
  },
}));
const showError = vi.fn();
const showNotice = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showError, showNotice }),
}));
const back = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back }),
  useRoute: () => ({ params: { id: 'M31' }, fullPath: '/sky/object/M31/edit' }),
}));

import ObjectEditPage from '../src/pages/sky/ObjectEditPage.vue';
import { skySelection } from '../src/composables/useSkySelection';

/** "Objet, modifier": the desktop's "Modifier les métadonnées DSO" as a page, from the map's object sheet. */

const mountPage = async () => {
  const w = mount(ObjectEditPage, { global: { stubs: ionicStubs } });
  await flushPromises();
  return w;
};
const field = (w: Awaited<ReturnType<typeof mountPage>>, label: string) =>
  w
    .findAll('.mob-form-row')
    .find((r) => r.find('label').text() === label)!
    .find('input');
const button = (w: Awaited<ReturnType<typeof mountPage>>, text: string) =>
  w.findAll('button').find((b) => b.text() === text || b.attributes('aria-label') === text)!;

describe('the object editor', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    override.value = undefined;
    upsertDsoOverride.mockReset().mockResolvedValue(undefined);
    deleteDsoOverride.mockReset().mockResolvedValue(undefined);
    applyAndStoreSingleOverride.mockReset();
    resetDsoToBaseValues.mockReset();
    showError.mockReset();
    showNotice.mockReset();
    back.mockReset();
    skySelection.value = { kind: 'dso', dso: M31 };
  });

  it("shows the desktop's fields, the catalogue's values as hints, the type and constellation chosen", async () => {
    const w = await mountPage();
    expect(w.find('h1').text()).toBe('Modifier les métadonnées DSO');
    expect(w.find('.mob-meta').text()).toBe('M31');
    expect(w.findAll('.mob-form-label').map((l) => l.text())).toEqual([
      'Nom en français',
      'Nom en anglais',
      'Nom en espagnol',
      'Nom en allemand',
      'Ascension droite (°)',
      'Déclinaison (°)',
      'Type',
      'Constellation (code IAU)',
      'Note photographique (1–5)',
      'Difficulté (1–5)',
    ]);
    expect(field(w, 'Nom en français').attributes('placeholder')).toBe("Galaxie d'Andromède");
    expect((field(w, 'Nom en français').element as HTMLInputElement).value).toBe('');
    expect(w.text()).toContain('GxS — Galaxie spirale (défaut)');
    expect(w.text()).toContain('Andromède (And) (défaut)');
  });

  it("shows the catalogue's hints and choices when the page opens before the catalogue is loaded", async () => {
    catalogue.loaded = false;
    const w = await mountPage();
    expect(field(w, 'Nom en anglais').attributes('placeholder')).toBe('Andromeda Galaxy');
    expect(w.text()).toContain('GxS — Galaxie spirale (défaut)');
    expect(w.text()).toContain('Andromède (And) (défaut)');
    await button(w, 'Réinitialiser').trigger('click');
    expect(w.text()).toContain('GxS — Galaxie spirale (défaut)');
  });

  it('saves what differs from the catalogue, applies it and goes back to the map, whose sheet reads it again', async () => {
    const w = await mountPage();
    const before = skySelection.value;
    await field(w, 'Nom en anglais').setValue('Andromeda');
    await field(w, 'Difficulté (1–5)').setValue('2');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    const saved = { names: { en: 'Andromeda' }, difficulty: 2 };
    expect(upsertDsoOverride).toHaveBeenCalledWith('M31', saved);
    expect(applyAndStoreSingleOverride).toHaveBeenCalledWith('M31', saved);
    expect(showNotice).toHaveBeenCalledWith('Modifications enregistrées');
    expect(back).toHaveBeenCalled();
    expect(skySelection.value).not.toBe(before);
    expect(skySelection.value).toEqual({ kind: 'dso', dso: M31 });
  });

  it('"Réinitialiser" empties the fields; saving then removes the correction', async () => {
    override.value = { names: { fr: 'Andromède' }, rating: 4 };
    const w = await mountPage();
    expect((field(w, 'Nom en français').element as HTMLInputElement).value).toBe('Andromède');
    await button(w, 'Réinitialiser').trigger('click');
    expect((field(w, 'Nom en français').element as HTMLInputElement).value).toBe('');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(deleteDsoOverride).toHaveBeenCalledWith('M31');
    expect(resetDsoToBaseValues).toHaveBeenCalledWith('M31');
    expect(upsertDsoOverride).not.toHaveBeenCalled();
  });

  it('refuses a right ascension out of range and stays on the page', async () => {
    const w = await mountPage();
    await field(w, 'Ascension droite (°)').setValue('400');
    await button(w, 'Enregistrer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalled();
    expect(upsertDsoOverride).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});
