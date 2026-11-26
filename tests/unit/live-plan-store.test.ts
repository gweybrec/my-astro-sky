import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  updatePlanArchivedAPI: vi.fn().mockResolvedValue(undefined),
}));

import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useLivePlanStore, type LiveAlertsPort } from '@myastrosky/app-state/stores/live-plan';
import { updatePlanArchivedAPI } from '@myastrosky/app-state/api';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { Plan } from '@myastrosky/core/domain/plans';
import type { PlanNight } from '@myastrosky/core/targets/plan';
import type { DSO } from '@myastrosky/core/types';

const MIN = 60_000;
const START = Date.UTC(2026, 10, 26, 20, 0);
const win = { start: new Date(START), end: new Date(START + 600 * MIN) };

function makePlan(): Plan {
  const w = (id: string, from: number, to: number) => ({
    id,
    startFrac: from / 600,
    endFrac: to / 600,
    filter: null,
    color: null,
    frameSeconds: null,
    snap: true,
  });
  return {
    id: 'p1',
    name: 'Tonight',
    position: 0,
    nightOf: null,
    setupId: null,
    lat: 48,
    lon: 2,
    sortBy: 'transit',
    archived: false,
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
        observationWindows: [w('wa', 60, 120)],
      },
      {
        id: 'b',
        dsoId: 'M42',
        position: 1,
        paDeg: null,
        ra: null,
        dec: null,
        notes: null,
        mosaicId: null,
        mosaicWDeg: null,
        mosaicHDeg: null,
        observationWindows: [w('wb', 120, 180)],
      },
    ],
    mosaics: [],
  };
}

const night: PlanNight = {
  loc: { latDeg: 48, lonDeg: 2 } as PlanNight['loc'],
  win,
  moon: null,
  phase: { phaseIndex: 0, illum: 0 },
  infos: ['a', 'b'].map((id) => ({
    entryId: id,
    dso: { id, displayName: id.toUpperCase(), ra: 10, dec: 40 } as DSO,
    maxAltDeg: 60,
    bestTimeUtc: new Date(START),
    curve: [],
    moonSepDeg: null,
  })),
};

function setup() {
  const port: LiveAlertsPort & { sync: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } =
    {
      sync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
  const plans = usePlansStore();
  plans.plans = [makePlan()];
  plans.loaded = true;
  const live = useLivePlanStore();
  live.install({
    resolveNight: () => night,
    alerts: port,
    t: (k) => k,
    clock: (ms) => `${(ms - START) / MIN}`,
  });
  return { port, plans, live };
}

describe('useLivePlanStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 30 * MIN);
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  afterEach(() => vi.useRealTimers());

  it('starting early shows "before start" and schedules every future alert', async () => {
    const { live, port } = setup();
    live.start('p1');
    await nextTick();
    expect(live.status.kind).toBe('before-start');
    expect(port.sync).toHaveBeenCalled();
    const [planId, status, notices] = port.sync.mock.calls.at(-1)!;
    expect(planId).toBe('p1');
    expect(status.title).toBe('live.status.startsAt');
    expect(notices.map((n: { kind: string }) => n.kind)).toEqual([
      'start',
      'reminder',
      'switch',
      'reminder',
      'finished',
    ]);
    expect(notices.at(-1).finished).toBe(true);
  });

  it('follows the clock: active, then finished asks to archive', async () => {
    const { live } = setup();
    live.start('p1');
    await vi.advanceTimersByTimeAsync(40 * MIN);
    expect(live.status).toMatchObject({ kind: 'active', current: { itemId: 'a' } });
    await vi.advanceTimersByTimeAsync(120 * MIN);
    expect(live.status.kind).toBe('finished');
    expect(live.askArchive).toBe(true);
  });

  it('+10 min moves the alerts and is rescheduled', async () => {
    const { live, port } = setup();
    live.start('p1');
    await vi.advanceTimersByTimeAsync(40 * MIN);
    port.sync.mockClear();
    live.extend();
    await nextTick();
    expect(live.slots.map((s) => (s.endMs - START) / MIN)).toEqual([130, 190]);
    expect(port.sync).toHaveBeenCalledTimes(1);
  });

  it('archive yes archives the plan and ends the live plan; no only ends it', async () => {
    const { live, plans, port } = setup();
    live.start('p1');
    live.answerArchive(false);
    expect(live.isLive).toBe(false);
    expect(plans.plans[0].archived).toBe(false);
    expect(port.clear).toHaveBeenCalled();
    live.start('p1');
    live.answerArchive(true);
    expect(updatePlanArchivedAPI).toHaveBeenCalledWith('p1', true);
    expect(plans.plans[0].archived).toBe(true);
  });

  it('a restart picks the live plan up again from the device', () => {
    setup().live.start('p1');
    setActivePinia(createPinia());
    const { live } = setup();
    expect(live.isLive).toBe(true);
    expect(live.state?.planId).toBe('p1');
  });

  it('deleting the plan stops it', async () => {
    const { live, plans } = setup();
    live.start('p1');
    plans.plans = [];
    await nextTick();
    expect(live.isLive).toBe(false);
  });

  it('only tonight or an undated plan can go live', () => {
    const { live } = setup();
    const p = makePlan();
    expect(live.canStart(p)).toBe(true);
    expect(live.canStart({ ...p, nightOf: '2026-11-01' })).toBe(false);
  });
});

describe('the notification once the plan has finished', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 30 * MIN);
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  afterEach(() => vi.useRealTimers());

  it('goes away when the plan ends with the app open, while the app asks to archive', async () => {
    const { live, port } = setup();
    live.start('p1');
    await vi.advanceTimersByTimeAsync(160 * MIN);
    expect(live.askArchive).toBe(true);
    expect(port.clear).toHaveBeenCalled();
  });

  it('goes away when Passer ends the last target', async () => {
    const { live, port } = setup();
    live.start('p1');
    await vi.advanceTimersByTimeAsync(100 * MIN);
    port.clear.mockClear();
    live.skip();
    await nextTick();
    expect(live.askArchive).toBe(true);
    expect(port.clear).toHaveBeenCalled();
  });
});
