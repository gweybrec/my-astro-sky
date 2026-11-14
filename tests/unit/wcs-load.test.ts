import { describe, it, expect } from 'vitest';
import {
  wcsChangeLabel,
  wcsChangeValues,
  wcsErrorMessage,
  wcsThrownErrorMessage,
  wcsWarningText,
} from '@myastrosky/core/wcs-load';
import type { WcsWarning } from '@myastrosky/core/wcs-file-checks';
import type { WcsChange } from '@myastrosky/core/photo-metadata-draft';
import { t } from '@myastrosky/core/i18n/index';

const sec = t('modal.metadataIntegrationsSecondsSuffix');

describe('wcsErrorMessage', () => {
  it('maps NO_WCS_DATA to the full "not plate-solved" message key', () => {
    const info = wcsErrorMessage({ code: 'NO_WCS_DATA' }, 'M31.fits');
    expect(info.key).toBe('modal.wcsNoMetadata');
    expect(info.params).toEqual({ filename: 'M31.fits' });
  });

  it('maps UNSUPPORTED_FORMAT to a parse error carrying the detail', () => {
    const info = wcsErrorMessage({ code: 'UNSUPPORTED_FORMAT', error: 'bad header' }, 'shot.tif');
    expect(info.key).toBe('modal.wcsParseError');
    expect(info.params).toEqual({ filename: 'shot.tif', detail: 'bad header' });
  });

  it('falls back to the format code when UNSUPPORTED_FORMAT has no error detail', () => {
    const info = wcsErrorMessage({ code: 'UNSUPPORTED_FORMAT' }, 'shot.tif');
    expect(info.key).toBe('modal.wcsParseError');
    expect(info.params.detail).toBe('UNSUPPORTED_FORMAT');
  });

  it('maps unknown/missing codes to a generic parse error', () => {
    expect(wcsErrorMessage({ code: 'WEIRD', error: 'boom' }, 'f.fits').params.detail).toBe('boom');
    expect(wcsErrorMessage({}, 'f.fits')).toEqual({
      key: 'modal.wcsParseError',
      params: { filename: 'f.fits', detail: 'unknown error' },
    });
  });
});
describe('wcsThrownErrorMessage', () => {
  it('keeps the thrown error text as the detail', () => {
    expect(wcsThrownErrorMessage(new Error('Server down'), 'a.fits')).toBe(
      t('modal.wcsParseError', { filename: 'a.fits', detail: 'Server down' }),
    );
  });
});

describe('wcsChangeLabel / wcsChangeValues', () => {
  it('names and formats a capture field with its unit', () => {
    const change: WcsChange = {
      key: 'capture.ccdTemp',
      field: 'ccdTemp',
      current: -10,
      incoming: -20,
    };
    expect(wcsChangeLabel(change)).toBe(t('modal.metadataCaptureCcdTemp'));
    expect(wcsChangeValues(change)).toEqual({ current: '-10 °C', incoming: '-20 °C' });
  });

  it('formats integration rows', () => {
    const change: WcsChange = {
      key: 'integrations',
      current: [
        { frames: 10, seconds: 60, filter: 'L' },
        { frames: 5, seconds: 30, filter: '' },
      ],
      incoming: [{ frames: 30, seconds: 120, filter: 'Ha' }],
    };
    expect(wcsChangeLabel(change)).toBe(t('modal.metadataIntegrations'));
    expect(wcsChangeValues(change)).toEqual({
      current: `10 × 60${sec} L, 5 × 30${sec}`,
      incoming: `30 × 120${sec} Ha`,
    });
  });

  it('shows a date as local date and time', () => {
    const change: WcsChange = {
      key: 'observationDate',
      current: '2024-01-02T03:04:05.000Z',
      incoming: '2024-02-02T03:04:05.000Z',
    };
    expect(wcsChangeValues(change).current).toMatch(/^2024-01-0[12] \d\d:04$/);
  });
});

describe('wcsWarningText', () => {
  it('gives a sentence for every kind of warning, with its values', () => {
    const all: WcsWarning[] = [
      { kind: 'dimensions', sourceW: 674, sourceH: 507, targetW: 3000, targetH: 1000 },
      { kind: 'truncated' },
      { kind: 'mainObject', dsoId: 'NGC7331' },
      { kind: 'messierMissing', dsoIds: ['M51', 'M63'] },
      { kind: 'messierExtra', dsoIds: ['M42'] },
      { kind: 'centerOutside' },
      { kind: 'object', object: 'M 42' },
      { kind: 'focalLength', headerMm: 540.2, setupMm: 1764 },
      { kind: 'pixelScale', fileArcsec: 0.8812, setupArcsec: 0.44 },
      { kind: 'telescope', header: 'ZWO AM5' },
      { kind: 'instrument', header: 'QHY268M' },
    ];
    const texts = all.map(wcsWarningText);
    for (const text of texts) {
      expect(text).not.toMatch(/^modal\.|\{\w+\}/);
    }
    expect(texts[0]).toContain('674');
    expect(texts[2]).toContain('NGC7331');
    expect(texts[3]).toContain('M51, M63');
    expect(texts[7]).toContain('540');
    expect(texts[7]).toContain('1764');
    expect(texts[8]).toContain('0.88');
    expect(texts[9]).toContain('ZWO AM5');
  });
});
