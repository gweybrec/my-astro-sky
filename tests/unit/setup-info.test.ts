import { describe, it, expect } from 'vitest';
import { buildSetupInfoRows } from '../../src/setup-info';
import type { TelescopeData, CameraData, AccessoryData } from '../../src/gear-catalog';

const TELESCOPE: TelescopeData = {
  id: 'celestron-c8-sct',
  brand: 'Celestron',
  model: 'C8 SCT',
  type: 'SCT',
  optical_design: 'Schmidt-Cassegrain',
  aperture_mm: 203.2,
  focal_length_mm: 2032,
  f_ratio: 10,
  is_smart_telescope: false,
  integrated_camera: false,
  integrated_camera_id: null,
  mount_interface: 'Losmandy',
  optical_notes: null,
  recommended_use: ['deep-sky'],
  status: 'active',
};

const CAMERA: CameraData = {
  id: 'atik-314l-plus',
  brand: 'Atik',
  model: '314L+',
  sensor: 'Sony ICX285AL',
  sensor_generation: 'CCD',
  color_type: 'Mono',
  sensor_width_mm: 8.98,
  sensor_height_mm: 6.71,
  pixel_size_um: 6.45,
  resolution_x: 1391,
  resolution_y: 1039,
  recommended_use: ['deep-sky'],
  status: 'active',
};

const REDUCER: AccessoryData = {
  id: 'celestron-fr-0-63',
  brand: 'Celestron',
  model: 'Focal Reducer 0.63×',
  type: 'focal-reducer',
  magnification_factor: 0.63,
  notes: null,
  thread_input: null,
  thread_output: null,
  status: 'active',
};

/** Convenience: turn the row tuples into a {label: value} map keyed by label. */
const asMap = (rows: [string, string][]) => Object.fromEntries(rows);

describe('buildSetupInfoRows', () => {
  it('lists telescope, camera, resolution, focal length and FOV', () => {
    const rows = buildSetupInfoRows(TELESCOPE, CAMERA, null);
    const map = asMap(rows);

    // Telescope + camera labels appear as values somewhere.
    const values = rows.map(([, v]) => v);
    expect(values).toContain('Celestron C8 SCT');
    expect(values).toContain('Atik 314L+');
    // Resolution row.
    expect(values).toContain('1391 × 1039 px');
    // Effective focal length (no accessory ⇒ native 2032 mm).
    expect(values).toContain('2032 mm');
    // FOV row present (keyed by the literal 'FOV').
    expect(map['FOV']).toMatch(/″\/px$/);
  });

  it('omits the accessory row when there is no accessory', () => {
    const rows = buildSetupInfoRows(TELESCOPE, CAMERA, null);
    const values = rows.map(([, v]) => v);
    expect(values).not.toContain('Celestron Focal Reducer 0.63×');
  });

  it('includes the accessory and applies its magnification to the focal length', () => {
    const rows = buildSetupInfoRows(TELESCOPE, CAMERA, REDUCER);
    const values = rows.map(([, v]) => v);
    expect(values).toContain('Celestron Focal Reducer 0.63×');
    // 2032 × 0.63 = 1280.16 ⇒ "1280 mm".
    expect(values).toContain('1280 mm');
  });
});
