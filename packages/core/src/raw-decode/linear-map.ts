/**
 * Faithful linear mapping from a normalised [0,1] sample (or an integer sample already
 * scaled to that range by the caller) to an 8-bit byte. No histogram/stretch is ever
 * applied here — this is the entire "export like a processing tool would, unedited" contract.
 */
export function toByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  return Math.round(v * 255);
}
