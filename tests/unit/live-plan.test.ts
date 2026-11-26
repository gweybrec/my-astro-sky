import { describe, it, expect } from 'vitest';
import type { ObservationWindow } from '@myastrosky/core/domain/plans';
import type { PlanTargetInfo } from '@myastrosky/core/targets/plan';
import type { DSO } from '@myastrosky/core/types';
import {
  DEFAULT_LIVE_OPTIONS,
  buildLiveAlerts,
  buildLiveSchedule,
  canGoLive,
  extendAdjustment,
  formatLiveAlert,
  formatLiveStatus,
  formatRemaining,
  liveActions,
  liveCard,
  liveStatusAt,
  nextTransitMs,
  skipAdjustment,
  type LiveOptions,
} from '@myastrosky/core/targets/live-plan';

const MIN = 60_000;
// A 10-hour night from 20:00 UTC: one fraction of a tenth is one hour.
const START = Date.UTC(2026, 10, 26, 20, 0);
const win = { start: new Date(START), end: new Date(START + 600 * MIN) };
const at = (minutes: number) => START + minutes * MIN;
const frac = (minutes: number) => minutes / 600;

const info = (id: string, ra = 10): PlanTargetInfo => ({
  entryId: id,
  dso: { id, displayName: id.toUpperCase(), ra, dec: 40 } as DSO,
  maxAltDeg: 60,
  bestTimeUtc: new Date(START),
  curve: [],
  moonSepDeg: null,
});
let n = 0;
const ow = (fromMin: number, toMin: number, filter: string | null = null): ObservationWindow => ({
  id: `w${++n}`,
  startFrac: frac(fromMin),
  endFrac: frac(toMin),
  filter,
  color: null,
  frameSeconds: null,
  snap: true,
});
const noExtras: LiveOptions = {
  ...DEFAULT_LIVE_OPTIONS,
  remindBeforeEnd: false,
  meridianFlip: false,
};

function schedule(
  entries: { id: string; windows: ObservationWindow[]; mosaic?: boolean }[],
  adjustments = [] as Parameters<typeof buildLiveSchedule>[2],
) {
  const plan = {
    entries: entries
      .filter((e) => !e.mosaic)
      .map((e) => ({ id: e.id, observationWindows: e.windows })),
    mosaics: entries
      .filter((e) => e.mosaic)
      .map((e) => ({ id: e.id, observationWindows: e.windows })),
  };
  return buildLiveSchedule(plan, { win, infos: entries.map((e) => info(e.id)) }, adjustments);
}

describe('buildLiveSchedule', () => {
  it('puts every window of entries and mosaics on the clock, in time order', () => {
    const slots = schedule([
      { id: 'm42', windows: [ow(120, 180)] },
      { id: 'mos', windows: [ow(0, 60)], mosaic: true },
    ]);
    expect(slots.map((s) => [s.itemId, s.isMosaic, s.startMs, s.endMs])).toEqual([
      ['mos', true, at(0), at(60)],
      ['m42', false, at(120), at(180)],
    ]);
    expect(slots[1].name).toBe('M42');
  });

  it('leaves out entries that are tiles of a mosaic or have no resolved target', () => {
    const plan = {
      entries: [
        { id: 'tile', mosaicId: 'mos', observationWindows: [ow(0, 60)] },
        { id: 'unknown', observationWindows: [ow(0, 60)] },
      ],
    };
    expect(buildLiveSchedule(plan, { win, infos: [info('tile')] })).toEqual([]);
  });

  it('keeps overlapping slots as drawn', () => {
    const slots = schedule([
      { id: 'a', windows: [ow(0, 90)] },
      { id: 'b', windows: [ow(60, 120)] },
    ]);
    expect(slots.map((s) => s.itemId)).toEqual(['a', 'b']);
  });
});

describe('adjustments', () => {
  const base = () => [
    { id: 'a', windows: [ow(0, 60)] },
    { id: 'b', windows: [ow(60, 120)] },
    { id: 'c', windows: [ow(180, 240)] },
  ];

  it('+10 min moves the end of the slot and every later slot', () => {
    const entries = base();
    const slots0 = schedule(entries);
    const slots = schedule(entries, [extendAdjustment(slots0[0])]);
    expect(slots.map((s) => [s.startMs, s.endMs])).toEqual([
      [at(0), at(70)],
      [at(70), at(130)],
      [at(190), at(250)],
    ]);
  });

  it('Skip ends the slot now and never starts a later slot before its drawn time', () => {
    const entries = base();
    const slots0 = schedule(entries);
    const slots = schedule(entries, [skipAdjustment(slots0[0], at(30))]);
    expect(slots.map((s) => [s.startMs, s.endMs])).toEqual([
      [at(0), at(30)],
      [at(60), at(120)],
      [at(180), at(240)],
    ]);
  });

  it('Skip after +10 takes the extra minutes back', () => {
    const entries = base();
    const s0 = schedule(entries);
    const s1 = schedule(entries, [extendAdjustment(s0[0])]);
    const s2 = schedule(entries, [extendAdjustment(s0[0]), skipAdjustment(s1[1], at(100))]);
    expect(s2.map((s) => [s.startMs, s.endMs])).toEqual([
      [at(0), at(70)],
      [at(70), at(100)],
      [at(180), at(240)],
    ]);
  });
});

describe('liveStatusAt', () => {
  const slots = schedule([
    { id: 'a', windows: [ow(60, 120)] },
    { id: 'b', windows: [ow(180, 240)] },
  ]);
  it('before the first slot, during a slot, in a gap and after the end', () => {
    expect(liveStatusAt(slots, at(0))).toMatchObject({
      kind: 'before-start',
      next: { itemId: 'a' },
    });
    expect(liveStatusAt(slots, at(60))).toMatchObject({
      kind: 'active',
      current: { itemId: 'a' },
      next: { itemId: 'b' },
    });
    expect(liveStatusAt(slots, at(120))).toMatchObject({ kind: 'gap', next: { itemId: 'b' } });
    expect(liveStatusAt(slots, at(200))).toMatchObject({
      kind: 'active',
      current: { itemId: 'b' },
      next: null,
    });
    expect(liveStatusAt(slots, at(240))).toEqual({ kind: 'finished' });
  });
  it('a plan without slots is finished', () => {
    expect(liveStatusAt([], at(0))).toEqual({ kind: 'finished' });
  });
});

describe('buildLiveAlerts', () => {
  const kinds = (alerts: ReturnType<typeof buildLiveAlerts>) =>
    alerts.map((a) => [a.kind, (a.atMs - START) / MIN]);

  it('start, end, switch and finished', () => {
    const slots = schedule([
      { id: 'a', windows: [ow(60, 120)] },
      { id: 'b', windows: [ow(120, 180)] },
      { id: 'c', windows: [ow(240, 300)] },
    ]);
    expect(kinds(buildLiveAlerts(slots, noExtras, 0))).toEqual([
      ['start', 60],
      ['switch', 120],
      ['end', 180],
      ['start', 240],
      ['finished', 300],
    ]);
  });

  it('one filter alert (with its reminder) between slots of the same target drawn end to end', () => {
    const slots = schedule([
      { id: 'a', windows: [ow(0, 60, 'Ha'), ow(60, 120, 'OIII'), ow(120, 180, 'OIII')] },
    ]);
    const alerts = buildLiveAlerts(slots, { ...noExtras, remindBeforeEnd: true }, 0);
    expect(kinds(alerts)).toEqual([
      ['start', 0],
      ['reminder', 55],
      ['filter', 60],
      ['reminder', 175],
      ['finished', 180],
    ]);
    expect(alerts[2].next?.filter).toBe('OIII');
  });

  it('reminder 5 min before each end, only when the slot is longer', () => {
    const slots = schedule([
      { id: 'a', windows: [ow(0, 60)] },
      { id: 'b', windows: [ow(90, 93)] },
    ]);
    expect(kinds(buildLiveAlerts(slots, { ...noExtras, remindBeforeEnd: true }, 0))).toEqual([
      ['start', 0],
      ['reminder', 55],
      ['end', 60],
      ['start', 90],
      ['finished', 93],
    ]);
  });

  it('meridian alert only when the transit falls inside the slot', () => {
    // Transit of RA 10° at lon 0 after the night start, computed the same way the module does.
    const transit = nextTransitMs(10, 0, START);
    const tMin = Math.round((transit - START) / MIN);
    const slots = schedule([
      { id: 'a', windows: [ow(Math.max(0, tMin - 60), tMin + 60)] },
      { id: 'b', windows: [ow(tMin + 120, tMin + 180)] },
    ]);
    const alerts = buildLiveAlerts(
      slots,
      { ...noExtras, meridianFlip: true, meridianMinutes: 10 },
      0,
    );
    const meridian = alerts.filter((a) => a.kind === 'meridian');
    expect(meridian).toHaveLength(1);
    expect(meridian[0].slot?.itemId).toBe('a');
    expect(Math.abs(meridian[0].atMs - (transit - 10 * MIN))).toBeLessThan(1000);
  });

  it('each alert carries the status from that moment', () => {
    const slots = schedule([
      { id: 'a', windows: [ow(0, 60)] },
      { id: 'b', windows: [ow(60, 120)] },
    ]);
    const alerts = buildLiveAlerts(slots, noExtras, 0);
    expect(alerts[1]).toMatchObject({
      kind: 'switch',
      status: { kind: 'active', current: { itemId: 'b' } },
    });
    expect(alerts.at(-1)?.status).toEqual({ kind: 'finished' });
  });
});

describe('nextTransitMs', () => {
  it('lands where the local sidereal time equals the RA, within a day', () => {
    const t = nextTransitMs(83.8, 2.35, START);
    expect(t).toBeGreaterThanOrEqual(START);
    expect(t - START).toBeLessThan(24 * 3600_000);
    expect(nextTransitMs(83.8, 2.35, t - 1000)).toBeCloseTo(t, -4);
  });
});

describe('canGoLive', () => {
  it('tonight or no date of its own, and not archived', () => {
    expect(canGoLive({ nightOf: '2026-11-26' }, '2026-11-26')).toBe(true);
    expect(canGoLive({ nightOf: null }, '2026-11-26')).toBe(true);
    expect(canGoLive({ nightOf: '2026-11-20' }, '2026-11-26')).toBe(false);
    expect(canGoLive({ nightOf: null, archived: true }, '2026-11-26')).toBe(false);
  });
});

describe('formatting', () => {
  const t = (key: string, p?: Record<string, string | number>) =>
    key +
    (p
      ? ' ' +
        Object.entries(p)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '');
  const clock = (ms: number) => `${(ms - START) / MIN}m`;
  const slots = schedule([
    { id: 'a', windows: [ow(0, 60, 'Ha')] },
    { id: 'b', windows: [ow(60, 120)] },
  ]);

  it('status lines', () => {
    expect(formatLiveStatus(liveStatusAt(slots, at(-10)), t, clock).title).toBe(
      'live.status.startsAt time=0m',
    );
    expect(formatLiveStatus(liveStatusAt(slots, at(10)), t, clock)).toEqual({
      title: 'live.status.current name=A (Ha),time=60m',
      body: 'live.status.next name=B,time=60m',
    });
  });

  it('alert lines', () => {
    const [, sw] = buildLiveAlerts(slots, noExtras, 0);
    expect(formatLiveAlert(sw, t, clock)).toEqual({
      title: 'live.alert.switch name=B',
      body: 'live.alert.switchBody prev=A,time=120m',
    });
  });
});

describe('the live card and the notification buttons', () => {
  const t = (key: string, p?: Record<string, string | number>) =>
    key +
    (p
      ? ' ' +
        Object.entries(p)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '');
  const clock = (ms: number) => `${(ms - START) / MIN}m`;
  const slots = schedule([
    { id: 'a', windows: [ow(0, 60, 'Ha')] },
    { id: 'b', windows: [ow(120, 180)] },
  ]);

  it('time left: hours and minutes, or minutes alone', () => {
    expect(formatRemaining(142 * MIN)).toBe('2 h 22');
    expect(formatRemaining(60 * MIN)).toBe('1 h 00');
    expect(formatRemaining(35 * MIN - 1000)).toBe('35 min');
    expect(formatRemaining(-5)).toBe('0 min');
  });

  it('while a target is imaged: its name, until when, its progress and what comes next', () => {
    expect(liveCard(liveStatusAt(slots, at(15)), slots, at(15), t, clock)).toEqual({
      title: 'A (Ha)',
      line: 'live.untilRemaining time=60m,left=45 min',
      progress: 0.25,
      next: 'live.nextAt name=B,time=120m',
    });
  });

  it('before the start, in a break and at the end', () => {
    expect(liveCard(liveStatusAt(slots, at(-10)), slots, at(-10), t, clock)).toMatchObject({
      title: 'live.status.startsAt time=0m',
      line: 'live.status.first name=A (Ha)',
      progress: null,
    });
    expect(liveCard(liveStatusAt(slots, at(90)), slots, at(90), t, clock)).toEqual({
      title: 'live.status.gap time=120m',
      line: 'live.prevDone name=A',
      progress: null,
      next: 'live.nextAt name=B,time=120m',
    });
    expect(liveCard({ kind: 'finished' }, slots, at(200), t, clock).title).toBe(
      'live.status.finished',
    );
  });

  it('Skip and +10 min only while a target is imaged; none once finished', () => {
    expect(liveActions(liveStatusAt(slots, at(15)))).toEqual(['skip', 'extend', 'stop']);
    expect(liveActions(liveStatusAt(slots, at(90)))).toEqual(['stop']);
    expect(liveActions({ kind: 'finished' })).toEqual([]);
  });
});
