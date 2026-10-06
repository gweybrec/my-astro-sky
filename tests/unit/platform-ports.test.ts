import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  configureStorage,
  storage,
  createMemoryStore,
} from '../../packages/core/src/platform/storage';
import { configureErrorReporter, reportError } from '@myastrosky/core/platform/error-hook';
import { detectInitialDensity } from '@myastrosky/core/density-slider';
import { configureGearCatalogLoader } from '@myastrosky/core/platform/gear-loader';
import { getTelescopes } from '@myastrosky/core/gear-catalog';
import { configureStarSearch } from '@myastrosky/core/platform/star-search';
import { searchUnified } from '@myastrosky/core/search';
import { createLocalStorageStore } from '../../src/platform-init';

describe('storage port', () => {
  const browserStore = storage();
  afterEach(() => {
    configureStorage(browserStore);
    vi.restoreAllMocks();
  });

  it('memory store: get/set/remove', () => {
    const s = createMemoryStore();
    expect(s.get('k')).toBeNull();
    s.set('k', 'v');
    expect(s.get('k')).toBe('v');
    s.remove('k');
    expect(s.get('k')).toBeNull();
  });

  it('configureStorage swaps what storage() returns', () => {
    const s = createMemoryStore();
    configureStorage(s);
    expect(storage()).toBe(s);
  });

  it('browser store reads and writes localStorage', () => {
    const s = createLocalStorageStore();
    s.set('port-test', 'x');
    expect(localStorage.getItem('port-test')).toBe('x');
    expect(s.get('port-test')).toBe('x');
    s.remove('port-test');
    expect(localStorage.getItem('port-test')).toBeNull();
  });

  it('browser store swallows a throwing localStorage', () => {
    const boom = () => {
      throw new Error('denied');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    const s = createLocalStorageStore();
    expect(s.get('k')).toBeNull();
    expect(() => s.set('k', 'v')).not.toThrow();
    expect(() => s.remove('k')).not.toThrow();
  });
});

describe('error hook', () => {
  it('forwards to the configured reporter, and defaults to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    configureErrorReporter((c, e) => console.error(c, e));
    const fn = vi.fn();
    configureErrorReporter(fn);
    const err = new Error('x');
    reportError('ctx', err);
    expect(fn).toHaveBeenCalledWith('ctx', err);
    spy.mockRestore();
  });
});

describe('detectInitialDensity(hints)', () => {
  it('uses defaults without hints', () => {
    expect(detectInitialDensity()).toEqual(detectInitialDensity({}));
  });
  it('a strong desktop beats a phone', () => {
    const desktop = detectInitialDensity({ hardwareConcurrency: 16, deviceMemory: 16 });
    const phone = detectInitialDensity({
      hardwareConcurrency: 16,
      deviceMemory: 16,
      userAgentData: { mobile: true },
    });
    expect(desktop).toEqual({ star: 3500, dso: 1500 });
    expect(phone.star).toBeLessThan(desktop.star);
  });
  it('detects a mobile user agent', () => {
    const ua = detectInitialDensity({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    expect(ua.star).toBeLessThan(detectInitialDensity({}).star);
  });
});

describe('gear catalog loader', () => {
  it('loads a list through the configured loader', async () => {
    const load = vi.fn().mockResolvedValue([{ id: 'scope-1' }]);
    configureGearCatalogLoader(load);
    const list = await getTelescopes();
    expect(load).toHaveBeenCalledWith('telescope');
    expect(list).toEqual([{ id: 'scope-1' }]);
  });
});

describe('star search hook', () => {
  it('searchUnified calls the configured remote search', async () => {
    const fn = vi.fn().mockResolvedValue([]);
    configureStarSearch(fn);
    await searchUnified('vega');
    expect(fn).toHaveBeenCalledWith('vega', 8);
  });
});
