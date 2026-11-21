import { t } from '../i18n/index';
import type { TargetSuggestion } from '../target-recommender';

/**
 * The warning texts of a target shown outside the user's criteria, one per criterion it misses, in a fixed order:
 * "Too low · 19° < 20°", "Too high · 81° > 80°", "Too big for the frame", "Already photographed".
 */
export function outsideLabels(
  s: Pick<TargetSuggestion, 'outside' | 'maxAltDeg'>,
  altRange: { minAltDeg: number; maxAltDeg: number },
): string[] {
  const reasons = s.outside ?? [];
  // The altitude as the row's facts print it, with a decimal when it would read as the limit itself (80.4° > 80°).
  const alt = (limit: number): string =>
    Math.round(s.maxAltDeg) === limit ? s.maxAltDeg.toFixed(1) : s.maxAltDeg.toFixed(0);
  const labels: string[] = [];
  if (reasons.includes('too-low')) {
    labels.push(
      t('targets.outside.tooLow', { alt: alt(altRange.minAltDeg), min: altRange.minAltDeg }),
    );
  }
  if (reasons.includes('too-high')) {
    labels.push(
      t('targets.outside.tooHigh', { alt: alt(altRange.maxAltDeg), max: altRange.maxAltDeg }),
    );
  }
  if (reasons.includes('too-big')) labels.push(t('targets.outside.tooBig'));
  if (reasons.includes('photographed')) labels.push(t('targets.outside.photographed'));
  return labels;
}
