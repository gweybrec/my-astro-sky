import { describe, it, expect } from 'vitest';
import {
  batchCounts,
  clearWcsSolution,
  commonLabels,
  commonValue,
  isSolvable,
  markChanged,
  matchesFilter,
  needsSaving,
  placementChip,
  sanitizeIntegrationRows,
  saveChip,
} from '../../src/batch-utils';
import type { BatchItem } from '../../src/batch-types';
import { makeItem } from '../helpers/batch-item';

const placed = (overrides: Partial<BatchItem> = {}) =>
  makeItem({
    status: 'success',
    placedBy: 'file',
    wcsResult: { success: true } as never,
    solveCorrespondences: [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' }],
    dsoIds: ['M31'],
    labels: ['galaxy'],
    integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
    observationDate: '2024-01-01T00:00:00.000Z',
    notes: 'my notes',
    ...overrides,
  });

describe('clearWcsSolution ("Retirer le placement")', () => {
  it('puts the photo back to "À résoudre" and drops what the solved file filled in', () => {
    const item = placed({ wcsFileName: 'a.fits' });
    clearWcsSolution(item);
    expect(item).toMatchObject({
      status: 'pending',
      wcsResult: null,
      solveCorrespondences: null,
      placedBy: undefined,
      wcsFileName: undefined,
      dsoIds: [],
      observationDate: '',
      integrations: [],
    });
    // What the user typed stays.
    expect(item.labels).toEqual(['galaxy']);
    expect(item.notes).toBe('my notes');
  });

  it('makes a saved photo "À réenregistrer"', () => {
    const item = placed({ saveState: 'saved', placementSaved: true });
    clearWcsSolution(item);
    expect(item.saveState).toBe('modified');
  });
});

describe('what the buttons take', () => {
  it('"Résoudre N photos" takes photos to place, failed or canceled ones', () => {
    expect(isSolvable(makeItem())).toBe(true);
    expect(isSolvable(makeItem({ status: 'failed' }))).toBe(true);
    expect(isSolvable(makeItem({ status: 'canceled' }))).toBe(true);
    for (const status of ['success', 'solving', 'waiting', 'converting', 'unfinished'] as const) {
      expect(isSolvable(makeItem({ status }))).toBe(false);
    }
  });

  it('"Enregistrer N photos" takes photos never saved or changed since, not while they are solved or saved', () => {
    expect(needsSaving(makeItem())).toBe(true);
    expect(needsSaving(makeItem({ status: 'failed' }))).toBe(true);
    expect(needsSaving(placed({ saveState: 'modified' }))).toBe(true);
    expect(needsSaving(placed({ saveState: 'saved' }))).toBe(false);
    expect(needsSaving(makeItem({ saveState: 'saving' }))).toBe(false);
    expect(needsSaving(makeItem({ status: 'solving' }))).toBe(false);
    expect(needsSaving(makeItem({ status: 'converting' }))).toBe(false);
    // A solve going on on astrometry.net ("En cours") can be saved: its submission is kept with the photo.
    expect(needsSaving(makeItem({ status: 'unfinished' }))).toBe(true);
  });

  it('counts both buttons and each filter', () => {
    const items = [
      placed(),
      placed({ saveState: 'saved', placementSaved: true }),
      makeItem(),
      makeItem({ status: 'failed' }),
      makeItem({ status: 'solving' }),
    ];
    expect(batchCounts(items)).toEqual({
      toSolve: 2,
      toSave: 3,
      solving: 1,
      byFilter: { all: 5, toPlace: 2, failed: 1, unsaved: 4, saved: 1 },
    });
  });

  it('nothing to solve when only solved files were loaded', () => {
    expect(batchCounts([placed(), placed()]).toSolve).toBe(0);
  });
});

describe('markChanged', () => {
  it('turns a saved photo into "À réenregistrer", and leaves a new one new', () => {
    const saved = placed({ saveState: 'saved', placementSaved: true });
    markChanged(saved);
    expect(saved.saveState).toBe('modified');
    expect(saved.placementSaved).toBe(true);
    markChanged(saved, { placement: true });
    expect(saved.placementSaved).toBe(false);
    const fresh = makeItem();
    markChanged(fresh);
    expect(fresh.saveState).toBe('new');
  });
});

describe('chips', () => {
  it('shows where the placement stands', () => {
    expect(placementChip(makeItem()).key).toBe('batch.chipToSolve');
    expect(placementChip(makeItem({ status: 'solving' })).key).toBe('mobile.gallery.solving');
    expect(placementChip(makeItem({ status: 'unfinished' })).key).toBe('mobile.gallery.unfinished');
    expect(placementChip(makeItem({ status: 'failed' })).tone).toBe('fail');
    expect(placementChip(placed()).key).toBe('mobile.gallery.alreadySolved');
    expect(placementChip(placed({ placedBy: 'hand' })).key).toBe('mobile.gallery.placedByHand');
    expect(placementChip(placed({ placedBy: 'local' })).key).toBe('mobile.gallery.placedSolved');
    expect(placementChip(placed({ placedBy: 'stars' }))).toMatchObject({
      key: 'mobile.gallery.placedByStars',
      params: { n: '1' },
    });
  });

  it('shows where the saving stands', () => {
    expect(saveChip(makeItem()).key).toBe('batch.chipUnsaved');
    expect(saveChip(makeItem({ saveState: 'saved' })).key).toBe('batch.chipSaved');
    expect(saveChip(makeItem({ saveState: 'modified' })).key).toBe('batch.chipResave');
  });
});

describe('batch edit', () => {
  it('finds the value the ticked photos share, or tells they differ', () => {
    const a = makeItem({ gearSetupId: 's1' });
    const b = makeItem({ gearSetupId: 's1' });
    const c = makeItem({ gearSetupId: null });
    expect(commonValue([a, b], (i) => i.gearSetupId)).toEqual({ mixed: false, value: 's1' });
    expect(commonValue([a, c], (i) => i.gearSetupId)).toEqual({ mixed: true });
  });

  it('splits the labels into those all have and those only some have', () => {
    const a = makeItem({ labels: ['été', 'nébuleuse'] });
    const b = makeItem({ labels: ['été'] });
    expect(commonLabels([a, b])).toEqual({ all: ['été'], some: ['nébuleuse'] });
  });

  it('filters the list', () => {
    expect(matchesFilter(makeItem({ status: 'unfinished' }), 'toPlace')).toBe(true);
    expect(matchesFilter(placed(), 'toPlace')).toBe(false);
    expect(matchesFilter(makeItem({ saveState: 'modified' }), 'unsaved')).toBe(true);
  });
});

describe('sanitizeIntegrationRows', () => {
  it('keeps whole non-negative numbers and trims the filter', () => {
    expect(sanitizeIntegrationRows([{ frames: -1, seconds: 1.5, filter: ' Ha ' }])).toEqual([
      { frames: 0, seconds: 0, filter: 'Ha' },
    ]);
  });
});
