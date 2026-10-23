import type { DSO } from '../types';

function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
}

/** True when the typed text appears in a target's name, one of its catalogue designations or its constellation (case, accents and spaces ignored: "ngc 7000" finds NGC7000). */
export function matchesTargetQuery(dso: DSO, query: string): boolean {
  const q = normalise(query);
  if (!q) return true;
  const fields = [dso.displayName ?? '', dso.id, dso.constellation ?? '', ...dso.catalogs];
  return fields.some((f) => normalise(f).includes(q));
}
