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
import { fovDeg, pixelScaleArcsec, formatFov, formatGearFovLabel } from './gear-presets';

/** Key/value rows describing a telescope + camera (+ optional accessory) setup. */
export function buildSetupInfoRows(
  tel: TelescopeData,
  cam: CameraData,
  acc: AccessoryData | null,
): [string, string][] {
  const summary = buildSetupSummary(tel, cam, acc);
  const rows: [string, string][] = [
    [t('targets.gear.telescope'), telescopeLabel(tel)],
    [t('targets.gear.camera'), cameraLabel(cam)],
    [t('targets.gear.info.resolution'), summary.resolution],
  ];
  if (acc) rows.push([t('targets.gear.accessory'), accessoryLabel(acc)]);
  rows.push([t('targets.gear.effectiveFocalLength'), `${summary.focalMm} mm`]);
  rows.push(['FOV', `${summary.fov} · ${summary.scale}`]);
  return rows;
}

/** What a setup list row and the setup editor print about a telescope + camera (+ optional accessory). */
export interface SetupSummary {
  /** "Askar FRA400 + ZWO ASI533MC": the gear, joined by " + ". */
  gearLine: string;
  /** Effective focal length in millimetres, as printed ("1422"). */
  focalMm: string;
  /** "6248 × 4176 px". */
  resolution: string;
  /** "57' × 38'". */
  fov: string;
  /** "0.5″/px". */
  scale: string;
  /** "1422 mm · FOV 57' × 38' · 0.5″/px" (the desktop's label on a FOV frame). */
  fovLabel: string;
}

export function buildSetupSummary(
  tel: TelescopeData,
  cam: CameraData,
  acc: AccessoryData | null,
): SetupSummary {
  const preset = buildGearPreset(tel, cam, acc);
  const { wDeg, hDeg } = fovDeg(preset);
  return {
    gearLine: [telescopeLabel(tel), cameraLabel(cam), ...(acc ? [accessoryLabel(acc)] : [])].join(
      ' + ',
    ),
    focalMm: preset.focalLengthMm.toFixed(0),
    resolution: `${cam.resolution_x} × ${cam.resolution_y} px`,
    fov: formatFov(wDeg, hDeg),
    scale: `${pixelScaleArcsec(preset).toFixed(1)}″/px`,
    fovLabel: formatGearFovLabel(preset),
  };
}
