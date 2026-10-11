import type { AccessoryData, CameraData, TelescopeData } from '../gear-catalog';
import { buildGearPreset } from '../gear-catalog';
import type { GearPreset } from '../gear-presets';
import { resolveSetupGear } from '../setup-gear';

/** The gear records a setup id is resolved against. */
export interface GearLists {
  setups: readonly {
    id: string;
    name: string;
    telescopeId: string;
    cameraId: string | null;
    accessoryId: string | null;
  }[];
  telescopes: readonly TelescopeData[];
  cameras: readonly CameraData[];
  accessories: readonly AccessoryData[];
}

/** A setup id resolved to its name and raw telescope / camera / accessory, or null when the setup or its gear is gone. */
export function resolveSetupById(
  setupId: string | null,
  lists: GearLists,
): { name: string; tel: TelescopeData; cam: CameraData; acc: AccessoryData | null } | null {
  if (!setupId) return null;
  const setup = lists.setups.find((s) => s.id === setupId);
  if (!setup) return null;
  const gear = resolveSetupGear(setup, lists.telescopes, lists.cameras, lists.accessories);
  if (!gear) return null;
  return { name: setup.name, ...gear };
}

/** A setup id resolved to a {@link GearPreset} (telescope + camera + accessory), or null. */
export function presetForSetupId(setupId: string | null, lists: GearLists): GearPreset | null {
  const resolved = resolveSetupById(setupId, lists);
  return resolved ? buildGearPreset(resolved.tel, resolved.cam, resolved.acc) : null;
}
