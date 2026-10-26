/**
 * The rules of choosing the gear of a setup (telescope, camera, accessory), shared by the desktop's setup window
 * and the phone's setup editor.
 */
import {
  resolveSetupCamera,
  type AccessoryData,
  type CameraData,
  type TelescopeData,
} from './gear-catalog';

export interface SetupGearChoice {
  telescopeId: string;
  cameraId: string | null;
  accessoryId: string | null;
}

/**
 * A choice made complete: with no telescope the first one of the catalogue; a smart telescope's sealed-in sensor
 * always wins as the camera (see `resolveSetupCamera`); with no camera at all the first one of the catalogue.
 */
export function reconcileSetupGear(
  choice: SetupGearChoice,
  telescopes: readonly TelescopeData[],
  cameras: readonly CameraData[],
): SetupGearChoice {
  const telescopeId = choice.telescopeId || telescopes[0]?.id || '';
  const tel = telescopes.find((t) => t.id === telescopeId);
  const resolved = tel ? resolveSetupCamera(tel, [...cameras], choice.cameraId) : null;
  const cameraId = resolved?.id ?? (choice.cameraId || cameras[0]?.id || null);
  return { telescopeId, cameraId, accessoryId: choice.accessoryId };
}

/**
 * The choice after picking a telescope. A smart telescope has its sensor inside the tube: its camera is pinned and it
 * takes no accessory, so the camera and accessory of the setup are overwritten (a stored accessory would give the setup
 * a wrong field of view).
 */
export function chooseTelescope(
  choice: SetupGearChoice,
  telescope: TelescopeData,
  cameras: readonly CameraData[],
): SetupGearChoice {
  if (!telescope.is_smart_telescope) return { ...choice, telescopeId: telescope.id };
  const resolved = resolveSetupCamera(telescope, [...cameras], choice.cameraId);
  return {
    telescopeId: telescope.id,
    cameraId: resolved?.id ?? choice.cameraId,
    accessoryId: null,
  };
}

/** The gear a choice points at, for the summary: nothing when the telescope or the camera is unknown. */
export function resolveSetupGear(
  choice: SetupGearChoice,
  telescopes: readonly TelescopeData[],
  cameras: readonly CameraData[],
  accessories: readonly AccessoryData[],
): { tel: TelescopeData; cam: CameraData; acc: AccessoryData | null } | null {
  const tel = telescopes.find((t) => t.id === choice.telescopeId);
  if (!tel) return null;
  const cam = resolveSetupCamera(tel, [...cameras], choice.cameraId);
  if (!cam) return null;
  const acc =
    choice.accessoryId && !tel.is_smart_telescope
      ? (accessories.find((a) => a.id === choice.accessoryId) ?? null)
      : null;
  return { tel, cam, acc };
}

/** A setup can be saved: it has a name and a telescope and a camera. */
export function canSaveSetup(name: string, choice: SetupGearChoice): boolean {
  return name.trim() !== '' && choice.telescopeId !== '' && !!choice.cameraId;
}
