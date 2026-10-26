import { describe, it, expect, beforeEach } from 'vitest';
import { configureStorage, createMemoryStore, storage } from '@myastrosky/core/platform/storage';
import {
  TARGETS_PREFS_KEY,
  formatLatLon,
  isValidLatLon,
  parseCoordinate,
  readObserverLocation,
  roundCoordinate,
  writeObserverLocation,
} from '@myastrosky/core/observer-location';
import {
  HORIZON_SETTINGS_KEY,
  loadHorizonSettings,
  saveHorizonSettings,
} from '@myastrosky/core/horizon-settings';
import {
  buildExportOptions,
  buildImportOptions,
  canExport,
  canImport,
  selectedPhotoBytes,
  SETUP_CHOICES,
  setupChoiceMissing,
  setupChoiceUnticks,
  setupLocked,
  setupNeedsChoice,
  setupTicked,
  type ImportSelection,
} from '@myastrosky/core/backup-selection';
import type { ImportPreviewResult } from '@myastrosky/core/domain/backup';

beforeEach(() => configureStorage(createMemoryStore()));

describe('observer location', () => {
  it('parses and validates coordinates', () => {
    expect(parseCoordinate(' 48,58 ')).toBe(48.58);
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('abc')).toBeNull();
    expect(isValidLatLon(48.58, 7.75)).toBe(true);
    expect(isValidLatLon(91, 0)).toBe(false);
    expect(isValidLatLon(0, -181)).toBe(false);
    expect(roundCoordinate(48.5849)).toBe(48.58);
    expect(formatLatLon({ lat: 48.58, lon: 7.75 })).toBe('48.58, 7.75');
    expect(formatLatLon({ lat: null, lon: null })).toBe('');
  });

  it('writes the Targets preferences (keeping the other fields) and the sky settings', () => {
    storage().set(
      TARGETS_PREFS_KEY,
      JSON.stringify({ setupId: 's1', lat: 1, lon: 2, sortBy: 'name' }),
    );
    writeObserverLocation(48.58, 7.75);
    const prefs = JSON.parse(storage().get(TARGETS_PREFS_KEY)!);
    expect(prefs).toMatchObject({ setupId: 's1', lat: 48.58, lon: 7.75, sortBy: 'name' });
    expect(JSON.parse(storage().get('sky-time-settings')!)).toMatchObject({
      lat: 48.58,
      lon: 7.75,
    });
    expect(readObserverLocation()).toEqual({ lat: 48.58, lon: 7.75 });
  });

  it('creates preferences the desktop accepts (with a setupId) and turns local sky off without a location', () => {
    storage().set('sky-time-settings', JSON.stringify({ lat: 1, lon: 2, localSkyMode: true }));
    writeObserverLocation(null, null);
    expect('setupId' in JSON.parse(storage().get(TARGETS_PREFS_KEY)!)).toBe(true);
    expect(JSON.parse(storage().get('sky-time-settings')!).localSkyMode).toBe(false);
  });

  it('falls back to the sky map location', () => {
    storage().set('sky-time-settings', JSON.stringify({ lat: 10, lon: 20 }));
    expect(readObserverLocation()).toEqual({ lat: 10, lon: 20 });
  });
});

describe('horizon settings', () => {
  it('round-trips and tolerates garbage', () => {
    expect(loadHorizonSettings()).toEqual({ enabled: false, obsHeightM: null, profile: null });
    saveHorizonSettings({ enabled: true, obsHeightM: 1.7, profile: null });
    expect(loadHorizonSettings()).toEqual({ enabled: true, obsHeightM: 1.7, profile: null });
    storage().set(HORIZON_SETTINGS_KEY, '{nope');
    expect(loadHorizonSettings().enabled).toBe(false);
  });
});

const preview = (over: Partial<ImportPreviewResult> = {}): ImportPreviewResult => ({
  hasMetadata: true,
  photos: 0,
  hasDsoOverrides: false,
  hasCustomGear: false,
  hasSetups: true,
  hasPoiCategories: false,
  hasSkyRegions: false,
  hasPlans: true,
  hasShortcuts: false,
  images: [],
  plans: [{ id: 'p1', name: 'Plan', exists: false, setupId: 'sA' }],
  setups: [
    { id: 'sA', name: 'A', exists: false, conflict: 'none' },
    { id: 'sB', name: 'B', exists: true, conflict: 'different', localId: 'x' },
    { id: 'sC', name: 'C', exists: true, conflict: 'identical', localId: 'y' },
  ],
  gear: [],
  ...over,
});
const sel = (over: Partial<ImportSelection> = {}): ImportSelection => ({
  importDso: true,
  importPoiCategories: true,
  importSkyRegions: true,
  importShortcuts: false,
  images: new Set(),
  plans: new Set(),
  setups: new Set(),
  gear: new Set(),
  setupChoices: {},
  ...over,
});

describe('backup selection', () => {
  it('builds the export options and the size', () => {
    const flags = {
      dsoOverrides: false,
      customGear: false,
      setups: true,
      poiCategories: false,
      skyRegions: false,
      plans: false,
      shortcuts: false,
    };
    expect(buildExportOptions(flags, 0)).toMatchObject({
      includeImages: false,
      includeMetadata: true,
      includeSetups: true,
    });
    expect(buildExportOptions(flags, 2).includeImages).toBe(true);
    expect(canExport({ ...flags, setups: false }, 0)).toBe(false);
    expect(canExport({ ...flags, setups: false }, 1)).toBe(true);
    expect(
      selectedPhotoBytes(
        [{ id: 'a', fileSize: 5 }, { id: 'b' }, { id: 'c', fileSize: 7 }],
        new Set(['a', 'b']),
      ),
    ).toBe(5);
  });

  it('locks a setup a ticked plan needs, and asks a choice for a different one', () => {
    const p = preview();
    const withPlan = sel({ plans: new Set(['p1']) });
    expect(setupLocked(p, withPlan.plans, p.setups[0])).toBe(true);
    expect(setupTicked(p, withPlan, p.setups[0])).toBe(true);
    expect(setupTicked(p, sel({ setups: new Set(['sC']) }), p.setups[2])).toBe(false);
    expect(setupNeedsChoice(p, sel({ setups: new Set(['sB']) }), p.setups[1])).toBe(true);
    expect(setupNeedsChoice(p, sel(), p.setups[1])).toBe(false);
  });

  it('can import only when something is ticked, and builds the restore options', () => {
    const p = preview({ images: [{ filename: 'f', originalName: 'f', size: 1, exists: false }] });
    expect(canImport(p, sel())).toBe(false);
    expect(canImport(p, sel({ images: new Set(['f']) }))).toBe(true);
    const options = buildImportOptions(
      p,
      sel({ setups: new Set(['sB']), setupChoices: { sB: 'replace', sA: 'skip' } }),
    );
    expect(options.selectedImages).toEqual([]);
    expect(options.setupConflicts).toEqual({ sB: 'replace' });
    expect(buildImportOptions(preview(), sel()).selectedImages).toBeNull();
  });

  it('offers three choices for a different setup, and waits for one before importing', () => {
    expect(SETUP_CHOICES.map((c) => c.value)).toEqual(['replace', 'keepBoth', 'skip']);
    const p = preview();
    expect(setupChoiceMissing(p, sel())).toBe(false);
    expect(setupChoiceMissing(p, sel({ setups: new Set(['sB']) }))).toBe(true);
    expect(
      setupChoiceMissing(p, sel({ setups: new Set(['sB']), setupChoices: { sB: 'keepBoth' } })),
    ).toBe(false);
  });

  it('treats "do not import" as unticking unless a ticked plan needs the setup', () => {
    const p = preview({
      plans: [{ id: 'p1', name: 'Plan', exists: false, setupId: 'sB' }],
    });
    const sB = p.setups[1];
    expect(setupChoiceUnticks(p, new Set(), sB, 'skip')).toBe(true);
    expect(setupChoiceUnticks(p, new Set(['p1']), sB, 'skip')).toBe(false);
    expect(setupChoiceUnticks(p, new Set(), sB, 'replace')).toBe(false);
  });
});
