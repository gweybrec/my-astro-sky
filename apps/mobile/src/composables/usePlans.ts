import { t } from '@myastrosky/core/i18n/index';
import { getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import type { GearLists } from '@myastrosky/core/targets/plan-setup';
import { customLocationLabelOr, type PlanTargetLookups } from '@myastrosky/core/targets/plan';
import { getGearSetups } from '@myastrosky/app-state/api';

/** What the plan pages read from the catalogues: the deep-sky registry, and the nearest named star for an empty-sky frame. */
export const planLookups: PlanTargetLookups = {
  getDsoById: getDSOById,
  customLabel: (ra, dec) => customLocationLabelOr(ra, dec, t('fovOverlay.customLocation')),
};

/** The setups with the gear records they are resolved against. */
export async function loadGearLists(): Promise<GearLists> {
  const [setups, telescopes, cameras, accessories] = await Promise.all([
    getGearSetups(),
    getTelescopes(),
    getCameras(),
    getAccessories(),
  ]);
  return { setups, telescopes, cameras, accessories };
}

/** "1 h 30 min", "2 h", "45 min". */
export function formatLongDuration(ms: number): string {
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
