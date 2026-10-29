import { describe, it, expect, beforeEach } from 'vitest';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { setHiddenGearIds } from '@myastrosky/core/gear-catalog';
import type { AccessoryData, CameraData, TelescopeData } from '@myastrosky/core/gear-catalog';
import {
  canSaveSetup,
  chooseTelescope,
  reconcileSetupGear,
  resolveSetupGear,
} from '@myastrosky/core/setup-gear';
import { buildSetupSummary } from '@myastrosky/core/setup-info';

const tel = (id: string, over: Partial<TelescopeData> = {}) =>
  ({
    id,
    brand: 'B',
    model: id,
    aperture_mm: 100,
    focal_length_mm: 500,
    f_ratio: 5,
    is_smart_telescope: false,
    integrated_camera_id: null,
    ...over,
  }) as TelescopeData;
const cam = (id: string) =>
  ({
    id,
    brand: 'C',
    model: id,
    sensor_width_mm: 10,
    sensor_height_mm: 10,
    pixel_size_um: 5,
    resolution_x: 2000,
    resolution_y: 2000,
    color_type: 'OSC',
  }) as CameraData;
const acc = (id: string) =>
  ({ id, brand: 'A', model: id, magnification_factor: 0.8 }) as AccessoryData;

const telescopes = [
  tel('t1'),
  tel('smart', { is_smart_telescope: true, integrated_camera_id: 'cs' }),
];
const cameras = [cam('c1'), cam('cs')];

describe('setup gear rules', () => {
  beforeEach(() => configureStorage(createMemoryStore()));

  it('fills a new choice with the first telescope and camera', () => {
    expect(
      reconcileSetupGear(
        { telescopeId: '', cameraId: null, accessoryId: null },
        telescopes,
        cameras,
      ),
    ).toEqual({
      telescopeId: 't1',
      cameraId: 'c1',
      accessoryId: null,
    });
  });

  it('fills a new choice with the first telescope and camera left ticked, and keeps a hidden built-in camera', () => {
    setHiddenGearIds('telescope', new Set(['t1']));
    setHiddenGearIds('camera', new Set(['c1', 'cs']));
    expect(
      reconcileSetupGear({ telescopeId: '', cameraId: null, accessoryId: null }, telescopes, [
        ...cameras,
        cam('c2'),
      ]),
    ).toEqual({ telescopeId: 'smart', cameraId: 'cs', accessoryId: null });
    expect(
      reconcileSetupGear({ telescopeId: 't1', cameraId: null, accessoryId: null }, telescopes, [
        ...cameras,
        cam('c2'),
      ]).cameraId,
    ).toBe('c2');
  });

  it('pins the integrated camera of a smart telescope and drops its accessory', () => {
    const picked = chooseTelescope(
      { telescopeId: 't1', cameraId: 'c1', accessoryId: 'a1' },
      telescopes[1],
      cameras,
    );
    expect(picked).toEqual({ telescopeId: 'smart', cameraId: 'cs', accessoryId: null });
    const plain = chooseTelescope(
      { telescopeId: 'smart', cameraId: 'cs', accessoryId: null },
      telescopes[0],
      cameras,
    );
    expect(plain.telescopeId).toBe('t1');
  });

  it('resolves the gear and summarises it', () => {
    const gear = resolveSetupGear(
      { telescopeId: 't1', cameraId: 'c1', accessoryId: 'a1' },
      telescopes,
      cameras,
      [acc('a1')],
    );
    expect(gear?.acc?.id).toBe('a1');
    expect(
      resolveSetupGear(
        { telescopeId: 'nope', cameraId: 'c1', accessoryId: null },
        telescopes,
        cameras,
        [],
      ),
    ).toBeNull();
    const s = buildSetupSummary(gear!.tel, gear!.cam, gear!.acc);
    expect(s.gearLine).toBe('B t1 + C c1 + A a1');
    expect(s.focalMm).toBe('400');
    expect(s.resolution).toBe('2000 × 2000 px');
    expect(s.fovLabel.startsWith('400 mm · FOV ')).toBe(true);
  });

  it('can be saved with a name, a telescope and a camera', () => {
    const choice = { telescopeId: 't1', cameraId: 'c1', accessoryId: null };
    expect(canSaveSetup(' x ', choice)).toBe(true);
    expect(canSaveSetup('  ', choice)).toBe(false);
    expect(canSaveSetup('x', { ...choice, cameraId: null })).toBe(false);
  });
});
