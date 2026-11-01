import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backend calls the Find targets form makes while it is built.
const getGearSetups = vi.fn();
vi.mock('../../src/api', () => ({
  getGearSetups: (...args: unknown[]) => getGearSetups(...args),
  getPhotos: vi.fn().mockResolvedValue([]),
  getPlans: vi.fn().mockResolvedValue([]),
  getSkyRegions: vi.fn().mockResolvedValue([]),
  createCustomGear: vi.fn(),
  deleteCustomGear: vi.fn(),
}));
vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  getSkyRegions: vi.fn().mockResolvedValue([]),
  getGearSetups: (...args: unknown[]) => getGearSetups(...args),
}));
vi.mock('@myastrosky/core/gear-catalog', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTelescopes: vi.fn().mockResolvedValue([]),
  getCameras: vi.fn().mockResolvedValue([]),
  getAccessories: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { TargetsView } from '../../src/targets-view';
import type { SkyMap } from '@myastrosky/render/sky-map';

const setup = {
  id: 's1',
  name: 'Refractor',
  telescopeId: 't1',
  cameraId: 'c1',
  accessoryId: null,
  enabled: true,
};

const flush = () => new Promise((r) => setTimeout(r));

describe('TargetsView — Find targets setup row', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="plans-container"></div>';
    getGearSetups.mockReset();
  });

  it('lists a setup created after the form was first opened', async () => {
    getGearSetups.mockResolvedValue([]);
    const view = new TargetsView({} as SkyMap, () => {});
    const root = view.getRecommendElement();
    await flush();
    const generate = () => root.querySelector<HTMLButtonElement>('.targets-generate-btn')!;
    expect(generate().disabled).toBe(true);

    // A setup is created from a plan header while the overlay is closed.
    getGearSetups.mockResolvedValue([setup]);
    expect(view.getRecommendElement()).toBe(root);
    await flush();

    const select = root.querySelector<HTMLSelectElement>('.targets-gear-row select')!;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(['s1']);
    expect(generate().disabled).toBe(false);
  });
});
