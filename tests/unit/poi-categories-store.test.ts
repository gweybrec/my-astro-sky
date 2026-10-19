/**
 * The POI-types store's `saveDraft` (the types editor's Enregistrer, desktop modal and phone page alike): the saved
 * types missing from the draft are deleted, the new ones created, the changed ones updated, nameless ones skipped.
 * Also the draft helpers of core `poi.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@myastrosky/app-state/api', () => ({
  getPoiCategories: vi.fn(),
  createPoiCategory: vi.fn().mockResolvedValue(undefined),
  updatePoiCategory: vi.fn().mockResolvedValue(undefined),
  deletePoiCategoryAPI: vi.fn().mockResolvedValue(undefined),
}));

import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import {
  createPoiCategory,
  deletePoiCategoryAPI,
  getPoiCategories,
  updatePoiCategory,
} from '@myastrosky/app-state/api';
import { poiTypesDraft, poiTypesDraftKey } from '@myastrosky/core/poi';
import type { PoiCategory } from '@myastrosky/core/types';

const SAVED: PoiCategory[] = [
  { id: 'cat-comet', name: 'Comète', color: '#4ea1ff', position: 0 },
  { id: 'cat-asteroid', name: 'Astéroïde', color: '#c9a227', position: 1 },
  { id: 'cat-iss', name: 'ISS', color: '#cbd5e1', position: 2 },
];

describe('poi-categories store · saveDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(getPoiCategories).mockResolvedValue(SAVED);
  });

  it('deletes, creates and updates what the draft changed, then reloads', async () => {
    const store = usePoiCategoriesStore();
    await store.load();
    const draft = poiTypesDraft(store.categories);
    draft[0].color = '#000000'; // comet recoloured
    draft.splice(2, 1); // ISS removed
    draft.push({ id: 'tmp-1', name: ' Météore ', color: '#ffffff', isNew: true });
    draft.push({ id: 'tmp-2', name: '  ', color: '#ffffff', isNew: true });

    await store.saveDraft(draft);

    expect(deletePoiCategoryAPI).toHaveBeenCalledExactlyOnceWith('cat-iss');
    expect(updatePoiCategory).toHaveBeenCalledExactlyOnceWith('cat-comet', {
      name: 'Comète',
      color: '#000000',
    });
    expect(createPoiCategory).toHaveBeenCalledExactlyOnceWith({
      name: 'Météore',
      color: '#ffffff',
    });
    expect(getPoiCategories).toHaveBeenCalledTimes(2);
  });

  it('changes nothing for an unchanged draft', async () => {
    const store = usePoiCategoriesStore();
    await store.load();
    await store.saveDraft(poiTypesDraft(store.categories));
    expect(deletePoiCategoryAPI).not.toHaveBeenCalled();
    expect(updatePoiCategory).not.toHaveBeenCalled();
    expect(createPoiCategory).not.toHaveBeenCalled();
  });
});

describe('poiTypesDraftKey()', () => {
  it('ignores spaces around names and the ids of new types', () => {
    const a = [{ id: 'tmp-1', name: 'X', color: '#fff', isNew: true }];
    const b = [{ id: 'tmp-9', name: ' X ', color: '#fff', isNew: true }];
    expect(poiTypesDraftKey(a)).toBe(poiTypesDraftKey(b));
    expect(poiTypesDraftKey(a)).not.toBe(poiTypesDraftKey([{ ...a[0], color: '#000' }]));
  });
});
