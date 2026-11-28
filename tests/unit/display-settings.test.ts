import { beforeEach, describe, expect, it } from 'vitest';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import {
  addLenticularType,
  addProtoplanetaryType,
  DEFAULT_SETTINGS,
  DSO_TYPES_ALL,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
} from '@myastrosky/core/display-settings';

let store: ReturnType<typeof createMemoryStore>;
beforeEach(() => {
  store = createMemoryStore();
  configureStorage(store);
});

describe('addProtoplanetaryType', () => {
  it('ticks PPN right after PN', () => {
    expect(addProtoplanetaryType(['EN', 'PN', 'SNR'])).toEqual(['EN', 'PN', 'PPN', 'SNR']);
  });

  it('leaves a selection without PN, or already with PPN, as it is', () => {
    expect(addProtoplanetaryType(['EN', 'SNR'])).toEqual(['EN', 'SNR']);
    expect(addProtoplanetaryType(['PPN', 'PN'])).toEqual(['PPN', 'PN']);
  });
});

describe('protoplanetary nebulae in the saved display settings', () => {
  it('are among the default types, after the planetary nebulae', () => {
    expect(DSO_TYPES_ALL.indexOf('PPN')).toBe(DSO_TYPES_ALL.indexOf('PN') + 1);
  });

  it('are ticked once in a selection saved before they existed', () => {
    const { dsoTypes: _all, ...rest } = DEFAULT_SETTINGS;
    store.set(SETTINGS_KEY, JSON.stringify({ ...rest, dsoTypes: ['EN', 'PN', '?'] }));
    expect(loadSettings().dsoTypes).toEqual(['EN', 'PN', 'PPN', '?']);
  });

  it('stay unticked when the user unticked them after the update', () => {
    saveSettings({ ...DEFAULT_SETTINGS, dsoTypes: ['EN', 'PN', '?'] });
    expect(loadSettings().dsoTypes).toEqual(['EN', 'PN', '?']);
    expect(loadSettings()).not.toHaveProperty('ppnTypeAdded');
  });
});

describe('addLenticularType', () => {
  it('ticks GxL right after GxE', () => {
    expect(addLenticularType(['GxS', 'GxE', 'GxI'])).toEqual(['GxS', 'GxE', 'GxL', 'GxI']);
  });

  it('leaves a selection without GxE, or already with GxL, as it is', () => {
    expect(addLenticularType(['GxS', 'GxI'])).toEqual(['GxS', 'GxI']);
    expect(addLenticularType(['GxL', 'GxE'])).toEqual(['GxL', 'GxE']);
  });
});

describe('lenticular galaxies in the saved display settings', () => {
  it('are among the default types, after the elliptical galaxies', () => {
    expect(DSO_TYPES_ALL.indexOf('GxL')).toBe(DSO_TYPES_ALL.indexOf('GxE') + 1);
  });

  it('are ticked once in a selection saved before they existed', () => {
    const { dsoTypes: _all, ...rest } = DEFAULT_SETTINGS;
    store.set(
      SETTINGS_KEY,
      JSON.stringify({ ...rest, ppnTypeAdded: true, dsoTypes: ['GxS', 'GxE', '?'] }),
    );
    expect(loadSettings().dsoTypes).toEqual(['GxS', 'GxE', 'GxL', '?']);
  });

  it('stay unticked when the user unticked them after the update', () => {
    saveSettings({ ...DEFAULT_SETTINGS, dsoTypes: ['GxS', 'GxE', '?'] });
    expect(loadSettings().dsoTypes).toEqual(['GxS', 'GxE', '?']);
    expect(loadSettings()).not.toHaveProperty('gxlTypeAdded');
  });
});
