import { describe, it, expect, beforeEach, vi } from 'vitest';

// parseServerError uses t() from i18n. Re-import per test so the cached lang resets.

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

// ─── parseServerError — server error code translation (Q6) ───────────────────

describe('parseServerError — code-based error translation', () => {
  it('translates RATE_LIMIT code in English', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'RATE_LIMIT' }, 'errors.uploadFailed');
    expect(result).not.toBe('errors.uploadFailed');
    expect(result).not.toContain('serverErrors.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('translates UPLOAD_RATE_LIMIT code in English', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'UPLOAD_RATE_LIMIT' }, 'errors.uploadFailed');
    expect(result).not.toBe('errors.uploadFailed');
    expect(result.length).toBeGreaterThan(0);
  });

  it('translates RATE_LIMIT code in French', async () => {
    localStorage.setItem('lang', 'fr');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'RATE_LIMIT' }, 'errors.uploadFailed');
    expect(result).not.toContain('serverErrors.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('translates RATE_LIMIT code in Spanish', async () => {
    localStorage.setItem('lang', 'es');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'RATE_LIMIT' }, 'errors.uploadFailed');
    expect(result).not.toContain('serverErrors.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('translates RATE_LIMIT code in German', async () => {
    localStorage.setItem('lang', 'de');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'RATE_LIMIT' }, 'errors.uploadFailed');
    expect(result).not.toContain('serverErrors.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('translates INVALID_IMAGE code', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ code: 'INVALID_IMAGE' }, 'errors.uploadFailed');
    expect(result).not.toContain('serverErrors.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to data.error when code has no translation', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError(
      { code: 'COMPLETELY_UNKNOWN_CODE_XYZ', error: 'Custom server message' },
      'errors.uploadFailed',
    );
    expect(result).toBe('Custom server message');
  });

  it('falls back to translated fallbackKey when neither code nor error is useful', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({}, 'errors.loadPhotos');
    // Should return the English translation of errors.loadPhotos, not the key
    expect(result).not.toBe('errors.loadPhotos');
    expect(result.length).toBeGreaterThan(0);
  });

  it('prefers code-based translation over data.error', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    // Both code and error present — code should win when it has a translation
    const codeTranslated = parseServerError(
      { code: 'RATE_LIMIT', error: 'Trop de requêtes, réessayez dans un instant' },
      'errors.uploadFailed',
    );
    const errorOnly = parseServerError(
      { error: 'Trop de requêtes, réessayez dans un instant' },
      'errors.uploadFailed',
    );
    // Code-translated version uses English, error-only version returns the French string
    expect(codeTranslated).not.toContain('Trop');
    expect(errorOnly).toContain('Trop');
  });

  it('returns data.error unchanged when code is absent (non-translated server message)', async () => {
    localStorage.setItem('lang', 'en');
    const { parseServerError } = await import('../../src/api');
    const result = parseServerError({ error: 'Something specific went wrong' }, 'errors.loadPhotos');
    expect(result).toBe('Something specific went wrong');
  });
});
