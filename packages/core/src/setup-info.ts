/**
 * Shared formatting for a gear setup's "info" rows.
 *
 * Single source of truth so the setup-info popup (Targets view) and the night-plan
 * PDF summary page render the exact same telescope/camera/accessory details. Add a
 * row here and it appears in both places automatically.
 */

import { t } from './i18n';
import {
  buildGearPreset,
  telescopeLabel,
  cameraLabel,
  accessoryLabel,
  type TelescopeData,
  type CameraData,
  type AccessoryData,
} from './gear-catalog';
import { fovDeg, pixelScaleArcsec, formatFov } from './gear-presets';

/** Key/value rows describing a telescope + camera (+ optional accessory) setup. */
export function buildSetupInfoRows(
  tel: TelescopeData,
  cam: CameraData,
  acc: AccessoryData | null,
): [string, string][] {
  const preset = buildGearPreset(tel, cam, acc);
  const { wDeg, hDeg } = fovDeg(preset);
  const scale = pixelScaleArcsec(preset);
  const rows: [string, string][] = [
    [t('targets.gear.telescope'), telescopeLabel(tel)],
    [t('targets.gear.camera'), cameraLabel(cam)],
    [t('targets.gear.info.resolution'), `${cam.resolution_x} × ${cam.resolution_y} px`],
  ];
  if (acc) rows.push([t('targets.gear.accessory'), accessoryLabel(acc)]);
  rows.push([t('targets.gear.effectiveFocalLength'), `${preset.focalLengthMm.toFixed(0)} mm`]);
  rows.push(['FOV', `${formatFov(wDeg, hDeg)} · ${scale.toFixed(1)}″/px`]);
  return rows;
}
