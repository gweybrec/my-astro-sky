/**
 * Pure helpers of the gallery's photo information panel (`MetadataSheet.vue`): how many object chips fit in the
 * folded list, the month grid of the date picker, and the text of the exposures' total.
 */
import type { PhotoIntegration } from '@myastrosky/core/types';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { integrationRowComplete, integrationTotalSeconds } from '@myastrosky/core/integration-rows';

/**
 * How many chips sit on the first `lines` lines, given each chip's top edge in order (a new line starts where the top
 * grows). All of them when they fit on `lines` lines or fewer.
 */
export function foldedChipCount(tops: readonly number[], lines = 3): number {
  let line = 0;
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] > tops[i - 1] + 0.5) {
      line++;
      if (line >= lines) return i;
    }
  }
  return tops.length;
}

export interface CalendarDay {
  year: number;
  /** 0 = January. */
  month: number;
  day: number;
  /** Belongs to the month shown (the others fill the first and last weeks, greyed). */
  inMonth: boolean;
}

/** The weeks of a month, Monday first, as whole weeks (the days of the months around fill the gaps). */
export function calendarWeeks(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  // Monday = 0 … Sunday = 6.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(year, month, 1 - lead + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    });
  }
  return weeks;
}

/** The total exposure of the rows that have both a count and a length, or `null` when fewer than two rows count. */
export function integrationsTotalText(rows: readonly PhotoIntegration[]): string | null {
  if (rows.filter(integrationRowComplete).length < 2) return null;
  return formatIntegrationTotal(integrationTotalSeconds(rows));
}

/** The observation date as read, in `lang` ("12 oct. 2025, 22:40"); `null` when there is none or it is not a date. */
export function observationDateText(iso: string, lang: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
}
