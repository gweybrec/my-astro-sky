import { ref } from 'vue';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { buildSetupSummary } from '@myastrosky/core/setup-info';
import { resolveSetupGear } from '@myastrosky/core/setup-gear';
import { t } from '@myastrosky/core/i18n/index';
import { getGearSetups, type GearSetupData } from '@myastrosky/app-state/api';
import { catalogsReady } from '../catalogs';

/** A gear setup and the two lines under its name: its gear, then its field. */
export interface SetupLine {
  setup: GearSetupData;
  /** Empty when the gear of the setup is no longer in the catalogue. */
  subs: string[];
}

/** The gear setups as the list "Réglages, setups" shows them; `load` reads them again. */
export function useSetupLines() {
  const lines = ref<SetupLine[]>([]);
  async function load(): Promise<void> {
    await catalogsReady();
    const [setups, telescopes, cameras, accessories] = await Promise.all([
      getGearSetups(),
      getTelescopes(),
      getCameras(),
      getAccessories(),
    ]);
    lines.value = setups.map((setup) => {
      const gear = resolveSetupGear(setup, telescopes, cameras, accessories);
      if (!gear) return { setup, subs: [] };
      const summary = buildSetupSummary(gear.tel, gear.cam, gear.acc);
      return {
        setup,
        subs: [summary.gearLine, t('mobile.gear.summary', { value: summary.fovLabel })],
      };
    });
  }
  return { lines, load };
}
