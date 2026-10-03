/** Wrap a right ascension (degrees) into [0, 360). */
export function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}
