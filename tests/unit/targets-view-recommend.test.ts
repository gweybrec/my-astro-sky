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

describe('TargetsView — objects outside the criteria', () => {
  const preset = {
    id: 'p',
    nameKey: 'p',
    apertureMm: 100,
    focalLengthMm: 500,
    sensorWidthMm: 22.3,
    sensorHeightMm: 14.9,
    pixelSizeUm: 4.3,
    mono: false,
    builtIn: false,
  };
  const target = (id: string, outside?: string[]) => ({
    dso: {
      id,
      ra: 0,
      dec: 0,
      type: 'EN',
      majAxis: 10,
      minAxis: 10,
      pa: 0,
      mag: 7,
      displayName: id,
      catalogs: [id],
      emissionLines: null,
      constellation: 'CYG',
      rating: 4,
      difficulty: 2,
    },
    maxAltDeg: 19.2,
    bestTimeUtc: new Date(Date.UTC(2026, 5, 21, 23)),
    score: 0.5,
    fovFitScore: 0.5,
    altScore: 0.5,
    brightnessScore: 0.5,
    ...(outside ? { outside } : {}),
  });

  beforeEach(() => {
    localStorage.clear();
    getGearSetups.mockResolvedValue([]);
  });

  /** Draws the results of a search that found `targets` and `outside`. */
  function render(targets: object[], outside: object[]): HTMLElement {
    const view = new TargetsView({} as SkyMap, () => {}) as any;
    view.lastPool = targets;
    view.lastOutside = outside;
    view.lastPreset = preset;
    view.lastAltRange = { minAltDeg: 20, maxAltDeg: 80 };
    const el = document.createElement('div');
    view.renderResults(el);
    return el;
  }

  it('shows them after the targets, under their title, dimmed with their warning chips', () => {
    const el = render([target('IN')], [target('LOW', ['too-low']), target('BIG', ['too-big'])]);
    const children = [...el.children];
    const titleAt = children.findIndex((c) => c.classList.contains('targets-outside-title'));
    expect(children[titleAt].textContent).toBe('Outside your criteria (2)');
    const cards = el.querySelectorAll('.target-card');
    expect(cards).toHaveLength(3);
    expect(children.indexOf(cards[0])).toBeLessThan(titleAt);
    expect(cards[0].querySelector('.targets-card-warn')).toBeNull();
    expect(cards[0].querySelector('.targets-card-dim')).toBeNull();
    const warns = [...el.querySelectorAll('.targets-card-warn')].map((w) => w.textContent);
    expect(warns.sort()).toEqual(['Too big for the frame', 'Too low · 19° < 20°']);
    expect(cards[1].querySelector('.target-card-title-row')!.classList).toContain(
      'targets-card-dim',
    );
    // The result count is the targets only.
    expect(el.querySelector('.targets-pagination-info')!.textContent).toMatch(/^1 /);
  });

  it('shows them without the no-target message when only they were found', () => {
    const el = render([], [target('LOW', ['too-low'])]);
    expect(el.querySelector('.targets-empty')).toBeNull();
    expect(el.querySelector('.targets-outside-title')).not.toBeNull();
    expect(el.querySelectorAll('.target-card')).toHaveLength(1);
  });

  it('has no title when none were found', () => {
    const el = render([target('IN')], []);
    expect(el.querySelector('.targets-outside-title')).toBeNull();
  });
});
