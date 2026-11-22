import { describe, it, expect } from 'vitest';
import {
  foldedChipCount,
  calendarWeeks,
  integrationsTotalText,
  observationDateText,
} from '../../src/metadata-sheet-utils';

describe('foldedChipCount', () => {
  it('keeps every chip when they fit on three lines', () => {
    expect(foldedChipCount([])).toBe(0);
    expect(foldedChipCount([0, 0, 0])).toBe(3);
    expect(foldedChipCount([0, 0, 26, 26, 52])).toBe(5);
  });

  it('stops at the first chip of the fourth line', () => {
    expect(foldedChipCount([0, 0, 26, 26, 52, 52, 78, 78, 104])).toBe(6);
  });

  it('takes the number of lines asked for', () => {
    expect(foldedChipCount([0, 0, 26, 52], 1)).toBe(2);
  });

  it('ignores sub-pixel differences on one line', () => {
    expect(foldedChipCount([0, 0.3, 0.2, 26, 52, 78], 3)).toBe(5);
  });
});

describe('calendarWeeks', () => {
  it('starts on Monday and fills the first and last weeks with the months around', () => {
    // October 2025 starts on a Wednesday and has 31 days: 5 weeks.
    const weeks = calendarWeeks(2025, 9);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({ year: 2025, month: 8, day: 29, inMonth: false });
    expect(weeks[0][2]).toEqual({ year: 2025, month: 9, day: 1, inMonth: true });
    // 12 October 2025 is a Sunday.
    expect(weeks[1][6]).toMatchObject({ day: 12, inMonth: true });
    expect(weeks[4][6]).toEqual({ year: 2025, month: 10, day: 2, inMonth: false });
  });

  it('crosses the year at both ends', () => {
    const jan = calendarWeeks(2026, 0);
    expect(jan[0][0]).toMatchObject({ year: 2025, month: 11 });
    const dec = calendarWeeks(2025, 11);
    expect(dec[dec.length - 1][6]).toMatchObject({ year: 2026, month: 0 });
  });
});

describe('integrationsTotalText', () => {
  it('adds up the complete rows once there are two of them', () => {
    expect(
      integrationsTotalText([
        { frames: 120, seconds: 180, filter: 'Ha' },
        { frames: 80, seconds: 180, filter: 'OIII' },
        { frames: 0, seconds: 60, filter: 'L' },
      ]),
    ).toBe('10h00');
  });

  it('has no total for a single complete row', () => {
    expect(integrationsTotalText([{ frames: 10, seconds: 60, filter: '' }])).toBeNull();
    expect(
      integrationsTotalText([
        { frames: 10, seconds: 60, filter: '' },
        { frames: 0, seconds: 60, filter: '' },
      ]),
    ).toBeNull();
  });
});

describe('observationDateText', () => {
  it('writes the date and time in the language given', () => {
    const iso = new Date(2025, 9, 12, 22, 40).toISOString();
    const text = observationDateText(iso, 'fr')!;
    expect(text).toContain('2025');
    expect(text).toContain('22:40');
  });

  it('has nothing to say without a valid date', () => {
    expect(observationDateText('', 'fr')).toBeNull();
    expect(observationDateText('not a date', 'fr')).toBeNull();
  });
});
