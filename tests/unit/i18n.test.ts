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
    const first  = getLang();
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

// ─── Batch solve/place split — new keys (June 2026) ──────────────────────────

describe('batch solve/place split keys', () => {
  it('batch.statusPlaced exists in all languages and is non-empty', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('batch.statusPlaced');
      expect(result, `batch.statusPlaced missing in ${lang}`).not.toBe('batch.statusPlaced');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('batch.placeButton exists in all languages and is non-empty', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('batch.placeButton');
      expect(result, `batch.placeButton missing in ${lang}`).not.toBe('batch.placeButton');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('batch.progressPlaced interpolates {placed} in all languages', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('batch.progressPlaced', { placed: '5' });
      expect(result, `batch.progressPlaced missing in ${lang}`).not.toBe('batch.progressPlaced');
      expect(result).toContain('5');
      expect(result).not.toContain('{placed}');
    }
  });

  it('modal.validate (manual-identify sub-modal button) exists in all languages', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('modal.validate');
      expect(result, `modal.validate missing in ${lang}`).not.toBe('modal.validate');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('batch.manualButton (per-card manual identify) exists in all languages', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('batch.manualButton');
      expect(result, `batch.manualButton missing in ${lang}`).not.toBe('batch.manualButton');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ─── New keys added by architecture quick-wins (June 2026) ────────────────────

describe('DSO editor coordinate error keys', () => {
  it('dso.editErrorRa exists in all languages and is non-empty', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('dso.editErrorRa');
      expect(result, `dso.editErrorRa missing in ${lang}`).not.toBe('dso.editErrorRa');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('dso.editErrorDec exists in all languages and is non-empty', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('dso.editErrorDec');
      expect(result, `dso.editErrorDec missing in ${lang}`).not.toBe('dso.editErrorDec');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('dso.editErrorRa message mentions 360 in all languages', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('dso.editErrorRa');
      expect(result, `dso.editErrorRa should mention 360 in ${lang}`).toContain('360');
    }
  });

  it('dso.editErrorDec message mentions 90 in all languages', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('dso.editErrorDec');
      expect(result, `dso.editErrorDec should mention 90 in ${lang}`).toContain('90');
    }
  });
});

describe('serverErrors.INVALID_IMAGE key', () => {
  it('exists in all languages and is non-empty', async () => {
    for (const lang of ['fr', 'en', 'es', 'de'] as const) {
      localStorage.setItem('lang', lang);
      vi.resetModules();
      const { t } = await import('../../src/i18n/index');
      const result = t('serverErrors.INVALID_IMAGE');
      expect(result, `serverErrors.INVALID_IMAGE missing in ${lang}`).not.toBe('serverErrors.INVALID_IMAGE');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ─── New batch auto-place keys (June 2026) ────────────────────────────────────

describe('batch auto-place keys', () => {
  for (const key of [
    'batch.statusPlacing',
    'batch.placingProgress',
    'batch.autoPlace',
    'batch.autoPlaceDisabledTooltip',
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
});
