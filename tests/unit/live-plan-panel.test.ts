import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia } from 'pinia';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../src/toast', () => ({ showToast }));
vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  updatePlanArchivedAPI: vi.fn().mockResolvedValue(undefined),
}));

import { pinia } from '../../src/pinia-instance';
import { buildLivePlanPanel } from '../../src/live-plan-panel';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { Plan } from '@myastrosky/core/domain/plans';
import type { PlanNight } from '@myastrosky/core/targets/plan';
import type { DSO } from '@myastrosky/core/types';

const MIN = 60_000;
const START = new Date(2026, 10, 26, 20, 0).getTime();
const win = { start: new Date(START), end: new Date(START + 600 * MIN) };

const plan: Plan = {
  id: 'p1',
  name: 'Tonight',
  position: 0,
  nightOf: null,
  setupId: null,
  lat: 48,
  lon: 2,
  sortBy: 'transit',
  archived: false,
  mosaics: [],
  entries: [
    {
      id: 'a',
      dsoId: 'M31',
      position: 0,
      paDeg: null,
      ra: null,
      dec: null,
      notes: null,
      mosaicId: null,
      mosaicWDeg: null,
      mosaicHDeg: null,
      observationWindows: [
        {
          id: 'w1',
          startFrac: 0,
          endFrac: 0.1,
          filter: null,
          color: null,
          frameSeconds: null,
          snap: true,
        },
      ],
    },
  ],
};
const night: PlanNight = {
  loc: { latDeg: 48, lonDeg: 2 } as PlanNight['loc'],
  win,
  moon: null,
  phase: { phaseIndex: 0, illum: 0 },
  infos: [
    {
      entryId: 'a',
      dso: { id: 'M31', displayName: 'Andromède', ra: 10, dec: 41 } as DSO,
      maxAltDeg: 60,
      bestTimeUtc: win.start,
      curve: [],
      moonSepDeg: null,
    },
  ],
};

function setup() {
  usePlansStore(pinia).plans = [structuredClone(plan)];
  const live = useLivePlanStore(pinia);
  live.install({
    resolveNight: () => night,
    alerts: {
      sync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    t: (k) => k,
    clock: (ms) => String(ms),
  });
  const locked = document.createElement('div');
  const lockedBtn = document.createElement('button');
  const lockedClick = vi.fn();
  lockedBtn.addEventListener('click', lockedClick);
  locked.appendChild(lockedBtn);
  const row = document.createElement('div');
  row.dataset.itemId = 'a';
  const panel = buildLivePlanPanel(plan, locked, () => [row]);
  document.body.append(panel.el, locked);
  return { live, panel, locked, lockedBtn, lockedClick, row };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START + 30 * MIN);
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(pinia);
  useLivePlanStore(pinia).stop();
  document.body.innerHTML = '';
  showToast.mockClear();
});
afterEach(() => vi.useRealTimers());

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent);

describe('the live panel of a desktop plan section', () => {
  it("offers to start tonight's plan, with its alerts", () => {
    const { panel } = setup();
    expect(buttons(panel.el)).toContain('Démarrer le plan');
    expect(panel.el.textContent).toContain('Rappel 5 min avant la fin de l’objet');
    expect(panel.el.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
  });

  it('started: the live card, the locked controls and the lit row', () => {
    const { live, panel, lockedBtn, lockedClick, row, locked } = setup();
    [...panel.el.querySelectorAll('button')]
      .find((b) => b.textContent === 'Démarrer le plan')!
      .click();
    expect(live.state?.planId).toBe('p1');
    panel.refresh();
    expect(panel.el.textContent).toContain('Andromède');
    expect(buttons(panel.el)).toEqual(expect.arrayContaining(['Passer', '+10 min', 'Arrêter']));
    expect(panel.el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(row.classList.contains('outline')).toBe(true);
    expect(locked.classList.contains('opacity-50')).toBe(true);
    lockedBtn.click();
    expect(lockedClick).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({
      message: 'Arrêtez le plan pour changer la nuit ou l’équipement',
      type: 'info',
    });
  });

  it('Arrêter: back to the start button, the controls free again', () => {
    const { live, panel, lockedBtn, lockedClick, row } = setup();
    live.start('p1');
    panel.refresh();
    [...panel.el.querySelectorAll('button')].find((b) => b.textContent === 'Arrêter')!.click();
    panel.refresh();
    expect(live.isLive).toBe(false);
    expect(buttons(panel.el)).toContain('Démarrer le plan');
    expect(row.classList.contains('outline')).toBe(false);
    lockedBtn.click();
    expect(lockedClick).toHaveBeenCalled();
  });

  it('another live plan has to be stopped first', () => {
    const { live, panel } = setup();
    usePlansStore(pinia).plans.push({ ...structuredClone(plan), id: 'p2', name: 'Other' });
    live.start('p2');
    panel.refresh();
    [...panel.el.querySelectorAll('button')]
      .find((b) => b.textContent === 'Démarrer le plan')!
      .click();
    expect(showToast).toHaveBeenCalledWith({
      message: 'Arrêtez d’abord le plan « Other »',
      type: 'info',
    });
    expect(live.state?.planId).toBe('p2');
  });
});
