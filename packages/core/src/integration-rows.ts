import { formatIntegrationTotal } from './format-utils';
import type { Photo, PhotoIntegration } from './types';

/**
 * How an exposure (integration) row reads, the same on the desktop and the phone. Any of its three fields may be
 * left empty: a missing count or length reads `na` ("N/A × 10 s", "183 × N/A"), a row with only a filter has no
 * time text at all (its filter badge says it all), and only a row with both a count and a length has a total.
 */

/** Whether the row says anything: a frame count, a length or a filter. A row with none is not saved. */
export function integrationRowHasData(row: PhotoIntegration): boolean {
  return row.frames >= 1 || row.seconds >= 1 || row.filter.trim() !== '';
}

/** Whether the row has both a count and a length, so that it has a total. */
export function integrationRowComplete(row: PhotoIntegration): boolean {
  return row.frames >= 1 && row.seconds >= 1;
}

/**
 * The row's count and length: "40 × 300 s", "N/A × 10 s", "183 × N/A"; '' for a row with only a filter.
 * `secondsSuffix` is written right after the length, with its space when one is wanted (" s" or "s").
 */
export function integrationRowTime(
  row: PhotoIntegration,
  na: string,
  secondsSuffix: string,
): string {
  if (row.frames < 1 && row.seconds < 1) return '';
  const frames = row.frames >= 1 ? String(row.frames) : na;
  const seconds = row.seconds >= 1 ? `${row.seconds}${secondsSuffix}` : na;
  return `${frames} × ${seconds}`;
}

/** The total exposure of the rows that have both a count and a length, in seconds (0 when none has). */
export function integrationTotalSeconds(rows: readonly PhotoIntegration[]): number {
  return rows
    .filter(integrationRowComplete)
    .reduce((sum, row) => sum + row.frames * row.seconds, 0);
}

/** The row's time with its total when it has one: "120 × 180s = 6h00", "N/A × 10s"; '' for a filter alone. */
export function integrationRowText(
  row: PhotoIntegration,
  na: string,
  secondsSuffix: string,
): string {
  const time = integrationRowTime(row, na, secondsSuffix);
  return integrationRowComplete(row)
    ? `${time} = ${formatIntegrationTotal(row.frames * row.seconds)}`
    : time;
}

/**
 * The filters the photos' exposure rows use, the most recently used first: photos are taken newest first (their
 * observation date, else when they were added), each filter once whatever its case, at most `limit` of them.
 */
export function recentIntegrationFilters(
  photos: readonly Pick<Photo, 'integrations' | 'observationDate' | 'createdAt'>[],
  limit = 5,
): string[] {
  const when = (p: Pick<Photo, 'observationDate' | 'createdAt'>) =>
    Date.parse(p.observationDate || p.createdAt) || 0;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const photo of [...photos].sort((a, b) => when(b) - when(a))) {
    for (const row of photo.integrations ?? []) {
      const name = row.filter.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
