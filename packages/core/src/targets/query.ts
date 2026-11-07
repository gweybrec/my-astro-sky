import type { DSO } from '../types';
import { dsoQueryVariants } from '../dso-query';

function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
}

/**
 * True when the typed text appears in a target's name, one of its catalogue designations or its constellation (case,
 * accents and spaces ignored: "ngc 7000" finds NGC7000), or does once a mistyped catalogue prefix is corrected
 * ("ngv 7000" too).
 */
export function matchesTargetQuery(dso: DSO, query: string): boolean {
  if (!normalise(query)) return true;
  const fields = [dso.displayName ?? '', dso.id, dso.constellation ?? '', ...dso.catalogs].map(
    normalise,
  );
  return dsoQueryVariants(query).some((variant) => {
    const q = normalise(variant);
    return fields.some((f) => f.includes(q));
  });
}
