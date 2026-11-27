import { describe, it, expect, beforeEach } from 'vitest';
import { setLang } from '@myastrosky/core/i18n/index';
import { DomainError } from '@myastrosky/core/domain/errors';
import {
  errorCauses,
  errorCodeOf,
  errorReportText,
  needsErrorRef,
  newErrorRef,
  translateErrorCode,
  userFacingError,
  userMessage,
} from '@myastrosky/core/platform/error-report';

beforeEach(() => {
  setLang('en');
});

describe('newErrorRef', () => {
  it('is four characters a user cannot misread', () => {
    for (let i = 0; i < 200; i++) expect(newErrorRef()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});

describe('errorCodeOf', () => {
  it('keeps a known code and turns anything else into INTERNAL_ERROR', () => {
    expect(errorCodeOf(new DomainError('upstream', 'x', { code: 'SKYBOT_FAILED' }))).toBe(
      'SKYBOT_FAILED',
    );
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('INTERNAL_ERROR');
    expect(errorCodeOf(new TypeError('boom'))).toBe('INTERNAL_ERROR');
    expect(errorCodeOf(undefined)).toBe('INTERNAL_ERROR');
  });
});

describe('userMessage', () => {
  it('never shows the raw message of an unexpected error', () => {
    const text = userMessage(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      'errors.updatePhoto',
    );
    expect(text).not.toContain('Cannot read');
    expect(text).not.toBe('errors.updatePhoto');
  });

  it('translates the code of a domain error', () => {
    expect(
      userMessage(new DomainError('upstream', 'Network error', { code: 'NETWORK_ERROR' }), 'x'),
    ).toBe('Network error, check the connection.');
  });

  it('shows a message written for the user as it is', () => {
    expect(userMessage(userFacingError('Already translated'), 'x')).toBe('Already translated');
    expect(userMessage('Also translated', 'x')).toBe('Also translated');
  });

  it('uses the fallback for an empty message', () => {
    expect(userMessage(userFacingError(''), 'errors.updatePhoto')).toBe(
      userMessage(new Error('raw'), 'errors.updatePhoto'),
    );
  });
});

describe('translateErrorCode', () => {
  it('uses the detail when the code has no text or its text needs a placeholder', () => {
    expect(translateErrorCode('NOT_A_CODE', 'detail', 'x')).toBe('detail');
    expect(translateErrorCode('SKYBOT_FAILED', 'SkyBoT error (503)', 'x')).toBe(
      'SkyBoT error (503)',
    );
  });
});

describe('needsErrorRef', () => {
  it('gives a reference for failures, not for what the user entered', () => {
    expect(needsErrorRef(new Error('bug'))).toBe(true);
    expect(needsErrorRef(new DomainError('upstream', 'x', { code: 'NETWORK_ERROR' }))).toBe(true);
    expect(needsErrorRef(new DomainError('invalid', 'x', { code: 'INVALID_IMAGE' }))).toBe(false);
    expect(needsErrorRef(userFacingError('Enter a number'))).toBe(false);
    expect(needsErrorRef(userFacingError('x', { code: 'HTTP_500', kind: 'upstream' }))).toBe(true);
    expect(needsErrorRef('a translated string')).toBe(false);
  });
});

describe('errorReportText', () => {
  it('holds the version, platform, code, reference and time', () => {
    const text = errorReportText(
      { code: 'NETWORK_ERROR', ref: 'AB12' },
      { version: '1.2.3', platform: 'Android', when: new Date('2026-01-02T03:04:05Z') },
    );
    expect(text).toBe(
      'MyAstroSky 1.2.3 (Android) · NETWORK_ERROR · AB12 · 2026-01-02T03:04:05.000Z',
    );
  });
});

describe('errorCauses', () => {
  it('lists what lies under an error, with codes, up to three levels', () => {
    const network = new DomainError('upstream', 'Failed to fetch', { code: 'NETWORK_ERROR' });
    const horizon = new DomainError('upstream', 'Horizon failed', {
      code: 'HORIZON_COMPUTE_FAILED',
    });
    Object.assign(horizon, { cause: network });
    const shown = userFacingError("Le calcul de l'horizon a échoué.", { cause: horizon });
    expect(errorCauses(shown)).toEqual([
      'DomainError: Horizon failed (HORIZON_COMPUTE_FAILED)',
      'DomainError: Failed to fetch (NETWORK_ERROR)',
    ]);
    expect(errorCauses(new Error('alone'))).toEqual([]);
  });
});
