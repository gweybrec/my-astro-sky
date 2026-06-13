import { describe, it, expect } from 'vitest';
import { getSolverAvailability } from '../../src/api';
import type { ServerSettings } from '../../src/api';

function makeSettings(overrides: Partial<ServerSettings> = {}): ServerSettings {
  return {
    apiKeySet: false,
    isWindows: false,
    ASTAP_PATH: '',
    SOLVE_FIELD_PATH: '',
    ASTROMETRY_DATA_DIR: '',
    USE_WSL_FOR_SOLVE_FIELD: false,
    USE_WSL_FOR_ASTAP: false,
    ...overrides,
  };
}

describe('getSolverAvailability', () => {
  it('all unavailable when paths and api key are empty', () => {
    expect(getSolverAvailability(makeSettings())).toEqual({
      solveField: false,
      astap: false,
      astrometry: false,
    });
  });

  it('solve-field available when SOLVE_FIELD_PATH is set', () => {
    const avail = getSolverAvailability(makeSettings({ SOLVE_FIELD_PATH: '/usr/bin/solve-field' }));
    expect(avail.solveField).toBe(true);
    expect(avail.astap).toBe(false);
    expect(avail.astrometry).toBe(false);
  });

  it('astap available when ASTAP_PATH is set', () => {
    const avail = getSolverAvailability(makeSettings({ ASTAP_PATH: '/opt/astap/astap_cli' }));
    expect(avail.solveField).toBe(false);
    expect(avail.astap).toBe(true);
    expect(avail.astrometry).toBe(false);
  });

  it('astrometry available when apiKeySet is true', () => {
    const avail = getSolverAvailability(makeSettings({ apiKeySet: true }));
    expect(avail.solveField).toBe(false);
    expect(avail.astap).toBe(false);
    expect(avail.astrometry).toBe(true);
  });

  it('all available when everything is configured', () => {
    const avail = getSolverAvailability(makeSettings({
      SOLVE_FIELD_PATH: '/usr/bin/solve-field',
      ASTAP_PATH: '/opt/astap/astap_cli',
      apiKeySet: true,
    }));
    expect(avail).toEqual({ solveField: true, astap: true, astrometry: true });
  });
});
