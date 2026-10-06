import { detectInitialDensity as detectInitialDensityFrom } from '@myastrosky/core/density-slider';

export * from '@myastrosky/core/density-slider';

/** {@link detectInitialDensityFrom} wired to the browser's `navigator`. */
export function detectInitialDensity(): { star: number; dso: number } {
  return detectInitialDensityFrom(typeof navigator !== 'undefined' ? navigator : {});
}
