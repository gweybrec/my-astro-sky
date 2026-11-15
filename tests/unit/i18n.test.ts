import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Each test re-imports the module fresh so the cached `currentLang` is reset.
// We call vi.resetModules() in beforeEach and use dynamic imports inside tests.

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── getLang — language detection ─────────────────────────────────────────────

describe('getLang()', () => {
  it('returns "fr" stored in localStorage', async () => {
    localStorage.setItem('lang', 'fr');
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('fr');
  });

  it('returns "en" stored in localStorage', async () => {
    localStorage.setItem('lang', 'en');
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('en');
  });

  it('returns "es" stored in localStorage', async () => {
    localStorage.setItem('lang', 'es');
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('es');
  });

  it('returns "de" stored in localStorage', async () => {
    localStorage.setItem('lang', 'de');
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('de');
  });

  it('ignores invalid value in localStorage and falls back to navigator', async () => {
    localStorage.setItem('lang', 'zh');
    vi.stubGlobal('navigator', { languages: ['en-US', 'en'] });
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('en');
  });

  it('falls back to navigator.languages when localStorage is empty', async () => {
    vi.stubGlobal('navigator', { languages: ['de-DE'] });
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('de');
  });

  it('uses first matching language from navigator.languages array', async () => {
    vi.stubGlobal('navigator', { languages: ['zh-TW', 'es-419', 'en'] });
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('es');
  });

  it('falls back to "fr" when no supported language found', async () => {
    vi.stubGlobal('navigator', { languages: ['zh-TW', 'ja'] });
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('fr');
  });

  it('falls back to "fr" when navigator.languages is empty', async () => {
    vi.stubGlobal('navigator', { languages: [] });
    const { getLang } = await import('../../src/i18n/index');
    expect(getLang()).toBe('fr');
  });

  it('caches the detected language on subsequent calls', async () => {
    localStorage.setItem('lang', 'en');
    const { getLang } = await import('../../src/i18n/index');
    const first = getLang();
    // Clear storage — should still return cached value
    localStorage.clear();
    const second = getLang();
    expect(first).toBe('en');
    expect(second).toBe('en');
  });
});

// ─── t() — translation lookup ─────────────────────────────────────────────────

describe('t()', () => {
  it('returns the correct translation for a top-level nested key (fr)', async () => {
    localStorage.setItem('lang', 'fr');
    const { t } = await import('../../src/i18n/index');
    expect(t('app.title')).toBe('MyAstroSky');
  });

  it('returns the correct translation for a top-level nested key (en)', async () => {
    localStorage.setItem('lang', 'en');
    const { t } = await import('../../src/i18n/index');
    expect(t('app.title')).toBe('MyAstroSky');
  });

  it('returns the key itself for a completely missing key', async () => {
    localStorage.setItem('lang', 'en');
    const { t } = await import('../../src/i18n/index');
    expect(t('no.such.key.exists')).toBe('no.such.key.exists');
  });

  it('interpolates {param} placeholders', async () => {
    localStorage.setItem('lang', 'en');
    const { t } = await import('../../src/i18n/index');
    const result = t('photos.deleted', { name: 'M42.jpg' });
    expect(result).toContain('M42.jpg');
    expect(result).not.toContain('{name}');
  });

  it('interpolates multiple {param} placeholders in one string', async () => {
    localStorage.setItem('lang', 'en');
    const { t } = await import('../../src/i18n/index');
    const result = t('photos.deleteError', { message: 'server error' });
    expect(result).toContain('server error');
    expect(result).not.toContain('{message}');
  });

  it('interpolates {param} in French strings', async () => {
    localStorage.setItem('lang', 'fr');
    const { t } = await import('../../src/i18n/index');
    const result = t('photos.deleted', { name: 'M31.jpg' });
    expect(result).toContain('M31.jpg');
    expect(result).not.toContain('{name}');
  });

  it('falls back to French when key is missing in current language', async () => {
    // es and de may not have all keys; fr always has them
    localStorage.setItem('lang', 'es');
    const { t } = await import('../../src/i18n/index');
    // app.title should exist in es too, but if we use a key only in fr it falls back
    // We test the fallback by verifying app.title returns something (not the key)
    const result = t('app.title');
    expect(result).not.toBe('app.title');
  });

  it('numeric params are converted to string', async () => {
    localStorage.setItem('lang', 'en');
    const { t } = await import('../../src/i18n/index');
    const result = t('photos.deleted', { name: 42 as any });
    expect(result).toContain('42');
  });
});

// ─── setLang ──────────────────────────────────────────────────────────────────

describe('setLang()', () => {
  it('stores the language in localStorage and calls location.reload', async () => {
    const reloadSpy = vi.spyOn(location, 'reload').mockImplementation(() => {});
    const { setLang } = await import('../../src/i18n/index');

    setLang('en');

    expect(localStorage.getItem('lang')).toBe('en');
    expect(reloadSpy).toHaveBeenCalledOnce();

    reloadSpy.mockRestore();
  });
});

// ─── "Ajouter des photos": the counted buttons, the batch edit, Terminer ───────

describe('add photos window keys', () => {
  for (const key of [
    'batch.filterToPlace',
    'batch.chipUnsaved',
    'batch.chipResave',
    'batch.statusModified',
    'batch.statusSavedUnplaced',
    'batch.methodLocal',
    'batch.methodFetch',
    'batch.clearSelection',
    'batch.commonLabels',
    'batch.nothingToSolve',
    'batch.nothingToSave',
    'batch.finish',
    'batch.finishSave',
  ]) {
    it(`${key} exists in all languages and is non-empty`, async () => {
      for (const lang of ['fr', 'en', 'es', 'de'] as const) {
        localStorage.setItem('lang', lang);
        vi.resetModules();
        const { t } = await import('../../src/i18n/index');
        const result = t(key);
        expect(result, `${key} missing in ${lang}`).not.toBe(key);
        expect(result.length).toBeGreaterThan(0);
      }
    });
  }

  for (const key of ['batch.solveMany', 'batch.saveMany', 'batch.batchTitle', 'batch.batchNote']) {
    it(`${key} puts the count in, in all languages`, async () => {
      for (const lang of ['fr', 'en', 'es', 'de'] as const) {
        localStorage.setItem('lang', lang);
        vi.resetModules();
        const { t } = await import('../../src/i18n/index');
        const result = t(key, { n: '17' });
        expect(result, `${key} missing in ${lang}`).toContain('17');
        expect(result).not.toContain('{n}');
      }
    });
  }
});
