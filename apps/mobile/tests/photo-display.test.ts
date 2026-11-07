import { beforeEach, describe, expect, it } from 'vitest';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import {
  autoRotateLandscape,
  loadPhotoDisplay,
  setAutoRotateLandscape,
  shownQuarterTurns,
  turnsForNextQuarter,
} from '../src/photo-display';

/** "Pivoter les photos en paysage" (board "Réglages, affichage"). */

const landscape = { width: 4000, height: 2000 };
const upright = { width: 2000, height: 4000 };
const on = { autoRotate: true, portrait: true };

describe('shownQuarterTurns', () => {
  it('turns a landscape photo a quarter on an upright phone', () => {
    expect(shownQuarterTurns(landscape, on)).toBe(1);
  });

  it('leaves a portrait photo, a sideways phone and the setting off alone', () => {
    expect(shownQuarterTurns(upright, on)).toBe(0);
    expect(shownQuarterTurns({ width: 3000, height: 3000 }, on)).toBe(0);
    expect(shownQuarterTurns(landscape, { autoRotate: true, portrait: false })).toBe(0);
    expect(shownQuarterTurns(landscape, { autoRotate: false, portrait: true })).toBe(0);
  });

  it("keeps the user's own rotation whatever the setting", () => {
    expect(shownQuarterTurns({ ...landscape, quarterTurns: 2 }, on)).toBe(2);
    expect(shownQuarterTurns({ ...upright, quarterTurns: 3 }, on)).toBe(3);
  });
});

describe('turnsForNextQuarter', () => {
  it('adds one quarter to what the photo has when the screen did not turn it', () => {
    expect(turnsForNextQuarter(0, 0)).toBe(1);
    expect(turnsForNextQuarter(2, 2)).toBe(1);
    expect(turnsForNextQuarter(3, 3)).toBe(1);
  });

  it('adds two when the screen showed it a quarter ahead of its own rotation', () => {
    expect(turnsForNextQuarter(0, 1)).toBe(2);
  });
});

describe('the setting', () => {
  beforeEach(() => configureStorage(createMemoryStore()));

  it('is on until switched off, and the choice is kept', () => {
    loadPhotoDisplay();
    expect(autoRotateLandscape.value).toBe(true);
    setAutoRotateLandscape(false);
    autoRotateLandscape.value = true;
    loadPhotoDisplay();
    expect(autoRotateLandscape.value).toBe(false);
    expect(storage().get('photo-auto-rotate-v1')).toBe('false');
  });
});
