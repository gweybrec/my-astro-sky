import { t } from '@myastrosky/core/i18n/index';
import { formatAlt } from '@myastrosky/core/format-utils';
import { searchedAlias } from '@myastrosky/core/search';
import { isOtherCatalogDso } from '@myastrosky/core/catalog/dso-registry';
import { formatArcmin, formatClock24 } from '@myastrosky/core/targets/format';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import type { TargetFigures } from '@myastrosky/core/targets/figures';
import type { DSO } from '@myastrosky/core/types';

/**
 * What a deep-sky object's row shows in the Cibles list and the map's search (PhoneTargetRow): its name with the
 * rating, its main designation followed by the one searched when it differs ("M31 · NGC224"), its type and
 * constellation, and the figures known: the highest point "time (altitude)", magnitude, size, score and field fit.
 */
export function targetCard(dso: DSO, figures: Partial<TargetFigures>, query = '') {
  // Under a name the main designation; without one the title is it. An object in no named catalogue has only a
  // compact key for an id, never shown.
  const main = dso.displayName && !isOtherCatalogDso(dso) ? dso.catalogs[0] || dso.id : undefined;
  const alias = query.trim() ? searchedAlias(dso, query) : undefined;
  const facts: { label: string; value: string }[] = [];
  const { bestTimeUtc, maxAltDeg, scorePct, fovFitPct } = figures;
  if (bestTimeUtc && maxAltDeg !== null && maxAltDeg !== undefined) {
    facts.push({
      label: t('targets.results.bestTime'),
      value: `${formatClock24(bestTimeUtc)} (${formatAlt(maxAltDeg)})`,
    });
  }
  if (dso.mag !== null) facts.push({ label: t('mobile.targets.mag'), value: dso.mag.toFixed(1) });
  if (dso.majAxis)
    facts.push({ label: t('targets.results.size'), value: formatArcmin(dso.majAxis) });
  if (scorePct !== null && scorePct !== undefined) {
    facts.push({
      label: t('targets.results.score'),
      value: t('mobile.format.percent', { n: scorePct }),
    });
  }
  if (fovFitPct !== null && fovFitPct !== undefined) {
    facts.push({
      label: t('targets.results.fov'),
      value: t('mobile.format.percent', { n: fovFitPct }),
    });
  }
  return {
    title: dso.displayName || dso.catalogs[0] || dso.id,
    designation: [main, alias].filter(Boolean).join(' · ') || undefined,
    typeLabel:
      dso.type === 'MS' && dso.multiplicity
        ? formatMultiplicity(dso.multiplicity, t)
        : t(`dso.types.${dso.type}`),
    constellation: dso.constellation?.toUpperCase(),
    rating: dso.rating !== null ? '★'.repeat(dso.rating) + '☆'.repeat(5 - dso.rating) : undefined,
    facts,
  };
}
