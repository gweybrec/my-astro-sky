import { ref } from 'vue';

// The filters chosen for exposure rows while the app runs, saved or not, the last chosen first: the list of filters
// offers them first ("Récents"), before the filters of the saved photos. Recent means used, not saved.
const chosen = ref<string[]>([]);

/** A filter was just chosen for an exposure row: it becomes the most recent one. */
export function noteFilterUse(name: string): void {
  const filter = name.trim();
  if (!filter) return;
  const key = filter.toLowerCase();
  chosen.value = [filter, ...chosen.value.filter((f) => f.toLowerCase() !== key)];
}

/**
 * The recent filters: those chosen while the app runs, the last first, then `fromPhotos` (the photos' filters, the
 * most recently used first), each once whatever its case, at most `limit`.
 */
export function recentFilters(fromPhotos: readonly string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...chosen.value, ...fromPhotos]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
    if (out.length >= limit) break;
  }
  return out;
}

/** Forgets the filters chosen so far (tests start from none). */
export function resetFilterUse(): void {
  chosen.value = [];
}
