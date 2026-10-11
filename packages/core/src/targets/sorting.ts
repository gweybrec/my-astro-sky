import type { TargetSuggestion } from '../target-recommender';
import type { SortKey } from './prefs';

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The page buttons of a paginated list: the first, the last and two either side of the current one, `null` for a gap. */
export function buildPageList(current: number, total: number): (number | null)[] {
  if (total <= 1) return [0];
  const pages = new Set<number>([0, total - 1]);
  for (let i = Math.max(0, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(null);
    result.push(sorted[i]);
  }
  return result;
}

export function sortSuggestions(
  suggestions: TargetSuggestion[],
  sortBy: SortKey,
): TargetSuggestion[] {
  const arr = [...suggestions];
  switch (sortBy) {
    case 'altitude':
      return arr.sort((a, b) => b.maxAltDeg - a.maxAltDeg);
    case 'transit':
      return arr.sort((a, b) => a.bestTimeUtc.getTime() - b.bestTimeUtc.getTime());
    case 'magnitude':
      return arr.sort((a, b) => (a.dso.mag ?? 99) - (b.dso.mag ?? 99));
    case 'size':
      return arr.sort((a, b) => (b.dso.majAxis ?? 0) - (a.dso.majAxis ?? 0));
    case 'fov-fit':
      return arr.sort((a, b) => b.fovFitScore - a.fovFitScore);
    case 'name':
      return arr.sort((a, b) =>
        (a.dso.catalogs[0] ?? a.dso.id).localeCompare(b.dso.catalogs[0] ?? b.dso.id, undefined, {
          numeric: true,
        }),
      );
    case 'rating':
      return arr.sort((a, b) => (b.dso.rating ?? 0) - (a.dso.rating ?? 0));
    case 'difficulty':
      return arr.sort((a, b) => (b.dso.difficulty ?? 0) - (a.dso.difficulty ?? 0));
    default:
      return arr.sort((a, b) => b.score - a.score);
  }
}
