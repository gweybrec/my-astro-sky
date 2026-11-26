// Live plan: tonight's plan followed in real time — its time slots on the clock, what is being imaged now, the alerts
// to raise (start, end, reminder, filter change, meridian flip, finished) and the Skip / +10 min adjustments.
// Platform-neutral: the phone schedules the alerts as notifications, the desktop raises them while open.

import { dateToJD, lstHours } from '../astro-time';
import type { ObservationWindow } from '../domain/plans';
import type { PlanTargetInfo } from './plan';

/** One observation window of a plan item, on the clock. */
export interface LiveSlot {
  /** The observation window's id. */
  windowId: string;
  /** The plan entry's id, or the mosaic's id. */
  itemId: string;
  isMosaic: boolean;
  name: string;
  filter: string | null;
  /** Start and end as drawn on the plan (ms since epoch). */
  plannedStartMs: number;
  plannedEndMs: number;
  /** Start and end after the live adjustments. */
  startMs: number;
  endMs: number;
  raDeg: number;
}

/** A change made while the plan is live: the slot `windowId` now ends at `endMs` (Skip: now; +10 min: 10 min later). */
export interface LiveAdjustment {
  windowId: string;
  endMs: number;
}

export interface LiveOptions {
  /** Alert a few minutes before the end of each target. */
  remindBeforeEnd: boolean;
  remindMinutes: number;
  /** Alert before the current target crosses the meridian (equatorial mounts flip there). */
  meridianFlip: boolean;
  meridianMinutes: number;
}

export const DEFAULT_LIVE_OPTIONS: LiveOptions = {
  remindBeforeEnd: true,
  remindMinutes: 5,
  meridianFlip: false,
  meridianMinutes: 10,
};

/** What is saved on the device while a plan is live. */
export interface LivePlanState {
  planId: string;
  startedAtMs: number;
  adjustments: LiveAdjustment[];
  options: LiveOptions;
}

export type LiveStatus =
  | { kind: 'before-start'; next: LiveSlot }
  | { kind: 'active'; current: LiveSlot; next: LiveSlot | null }
  | { kind: 'gap'; next: LiveSlot }
  | { kind: 'finished' };

export type LiveAlertKind =
  /** A target starts (nothing ended at the same moment). */
  | 'start'
  /** A target ends and nothing starts at the same moment. */
  | 'end'
  /** A target ends and the next one starts at the same moment. */
  | 'switch'
  /** Same target, next slot uses another filter. */
  | 'filter'
  /** A few minutes before the end of a target. */
  | 'reminder'
  /** A few minutes before the current target crosses the meridian. */
  | 'meridian'
  /** The last slot ended. */
  | 'finished';

export interface LiveAlert {
  kind: LiveAlertKind;
  atMs: number;
  /** The slot the alert is about (the one ending for end/switch/reminder, starting for start/filter). */
  slot: LiveSlot | null;
  /** The slot starting, for 'switch' and 'filter'. */
  next: LiveSlot | null;
  /** Meridian crossing time, for 'meridian'. */
  transitMs?: number;
  /** The status from this moment on (what the visible notification shows). */
  status: LiveStatus;
}

/** Two moments closer than this count as the same moment (slots drawn end to end on the chart). */
const SAME_MOMENT_MS = 60_000;
const SIDEREAL_RATE = 1.00273790935;

interface WindowSource {
  id: string;
  observationWindows?: readonly ObservationWindow[];
}

/**
 * The plan's observation windows on the clock, in time order (start, then end), with the live adjustments applied.
 * Items without a resolved target (no position) are left out; windows of every entry and mosaic are kept, gaps and
 * overlaps as drawn.
 */
export function buildLiveSchedule(
  plan: {
    entries: readonly (WindowSource & { mosaicId?: string | null })[];
    mosaics?: readonly WindowSource[];
  },
  night: { win: { start: Date; end: Date }; infos: readonly PlanTargetInfo[] },
  adjustments: readonly LiveAdjustment[] = [],
): LiveSlot[] {
  const startMs = night.win.start.getTime();
  const span = night.win.end.getTime() - startMs;
  const infoById = new Map(night.infos.map((i) => [i.entryId, i]));
  const slots: LiveSlot[] = [];
  const add = (item: WindowSource, isMosaic: boolean) => {
    const info = infoById.get(item.id);
    if (!info) return;
    for (const w of item.observationWindows ?? []) {
      const s = Math.round(startMs + w.startFrac * span);
      const e = Math.round(startMs + w.endFrac * span);
      if (e <= s) continue;
      slots.push({
        windowId: w.id,
        itemId: item.id,
        isMosaic,
        name: info.dso.displayName || info.dso.id,
        filter: w.filter,
        plannedStartMs: s,
        plannedEndMs: e,
        startMs: s,
        endMs: e,
        raDeg: info.dso.ra,
      });
    }
  };
  for (const e of plan.entries) if (!e.mosaicId) add(e, false);
  for (const m of plan.mosaics ?? []) add(m, true);
  slots.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return applyAdjustments(slots, adjustments);
}

/**
 * Apply the adjustments in the order they were made. A slot's new end moves every later slot by the same amount; a
 * later slot never starts before the time it was drawn at (Skip only takes back earlier +10 min).
 */
function applyAdjustments(slots: LiveSlot[], adjustments: readonly LiveAdjustment[]): LiveSlot[] {
  const shift = slots.map(() => 0);
  const endOverride = new Map<number, number>();
  for (const adj of adjustments) {
    const i = slots.findIndex((s) => s.windowId === adj.windowId);
    if (i < 0) continue;
    const currentEnd = endOverride.get(i) ?? slots[i].plannedEndMs + shift[i];
    const startI = slots[i].plannedStartMs + shift[i];
    const newEnd = Math.max(adj.endMs, startI);
    const delta = newEnd - currentEnd;
    endOverride.set(i, newEnd);
    for (let j = i + 1; j < slots.length; j++) {
      shift[j] = Math.max(0, shift[j] + delta);
      // A later slot whose end was overridden keeps its length relative to the shift.
      const o = endOverride.get(j);
      if (o != null) endOverride.set(j, Math.max(o + delta, slots[j].plannedStartMs + shift[j]));
    }
  }
  return slots.map((s, i) => {
    const start = s.plannedStartMs + shift[i];
    return { ...s, startMs: start, endMs: endOverride.get(i) ?? s.plannedEndMs + shift[i] };
  });
}

/** What is happening at `nowMs`. A slot is active from its start (included) to its end (excluded). */
export function liveStatusAt(slots: readonly LiveSlot[], nowMs: number): LiveStatus {
  if (!slots.length || nowMs >= Math.max(...slots.map((s) => s.endMs))) return { kind: 'finished' };
  const i = slots.findIndex((s) => s.startMs <= nowMs && nowMs < s.endMs);
  if (i >= 0) {
    const current = slots[i];
    const next =
      slots.slice(i + 1).find((s) => s.startMs >= current.startMs && s.endMs > nowMs) ?? null;
    return { kind: 'active', current, next };
  }
  const next = slots.find((s) => s.startMs > nowMs)!;
  return nowMs < slots[0].startMs ? { kind: 'before-start', next } : { kind: 'gap', next };
}

/** The first upper transit of `raDeg` at or after `fromMs` (ms), for an observer at `lonDeg`. */
export function nextTransitMs(raDeg: number, lonDeg: number, fromMs: number): number {
  const lst = lstHours(dateToJD(new Date(fromMs)), lonDeg);
  const hoursSidereal = (((raDeg / 15 - lst) % 24) + 24) % 24;
  return fromMs + (hoursSidereal / SIDEREAL_RATE) * 3_600_000;
}

const sameMoment = (a: number, b: number) => Math.abs(a - b) < SAME_MOMENT_MS;

/**
 * Every alert of the live plan, in time order. Slots of the same target drawn end to end with the same filter are one
 * continuous run (no alert between them); with another filter they raise one 'filter' alert. An end and a start at the
 * same moment raise one 'switch' alert. The last end is the 'finished' alert.
 */
export function buildLiveAlerts(
  slots: readonly LiveSlot[],
  options: LiveOptions,
  lonDeg: number,
): LiveAlert[] {
  if (!slots.length) return [];
  const out: Omit<LiveAlert, 'status'>[] = [];
  const lastEnd = Math.max(...slots.map((s) => s.endMs));
  // Which slot follows each slot on the same target, end to end.
  const continuedBy = (s: LiveSlot) =>
    slots.find((t) => t !== s && t.itemId === s.itemId && sameMoment(t.startMs, s.endMs)) ?? null;
  const startsAt = (ms: number, except: LiveSlot) =>
    slots.find((t) => t !== except && t.itemId !== except.itemId && sameMoment(t.startMs, ms)) ??
    null;
  const continuing = new Set<LiveSlot>();
  const startedBySwitch = new Set<LiveSlot>();

  for (const s of slots) {
    const cont = continuedBy(s);
    if (cont) {
      continuing.add(cont);
      if (cont.filter !== s.filter)
        out.push({ kind: 'filter', atMs: cont.startMs, slot: s, next: cont });
      continue; // the run goes on: no end alert, no reminder
    }
    if (s.endMs === lastEnd) continue; // the 'finished' alert below
    const next = startsAt(s.endMs, s);
    if (next) {
      startedBySwitch.add(next);
      out.push({ kind: 'switch', atMs: s.endMs, slot: s, next });
    } else out.push({ kind: 'end', atMs: s.endMs, slot: s, next: null });
  }
  for (const s of slots) {
    if (!continuing.has(s) && !startedBySwitch.has(s))
      out.push({ kind: 'start', atMs: s.startMs, slot: s, next: null });
    const cont = continuedBy(s);
    if (options.remindBeforeEnd && !(cont && cont.filter === s.filter)) {
      const at = s.endMs - options.remindMinutes * 60_000;
      if (at > s.startMs) out.push({ kind: 'reminder', atMs: at, slot: s, next: null });
    }
    if (options.meridianFlip && !continuing.has(s)) {
      const transit = nextTransitMs(s.raDeg, lonDeg, s.startMs);
      if (transit < runEnd(s, slots)) {
        const at = Math.max(s.startMs, transit - options.meridianMinutes * 60_000);
        out.push({ kind: 'meridian', atMs: at, slot: s, next: null, transitMs: transit });
      }
    }
  }
  const last = slots.find((s) => s.endMs === lastEnd)!;
  out.push({ kind: 'finished', atMs: lastEnd, slot: last, next: null });

  const order: Record<LiveAlertKind, number> = {
    end: 0,
    switch: 1,
    filter: 2,
    finished: 3,
    start: 4,
    reminder: 5,
    meridian: 6,
  };
  out.sort((a, b) => a.atMs - b.atMs || order[a.kind] - order[b.kind]);
  return out.map((a) => ({ ...a, status: liveStatusAt(slots, a.atMs) }));
}

/** The end of the run of same-target slots drawn end to end from `s`. */
function runEnd(s: LiveSlot, slots: readonly LiveSlot[]): number {
  let end = s.endMs;
  for (;;) {
    const cont = slots.find(
      (t) => t.itemId === s.itemId && sameMoment(t.startMs, end) && t.endMs > end,
    );
    if (!cont) return end;
    end = cont.endMs;
  }
}

/** Skip: the current slot ends now. */
export function skipAdjustment(slot: LiveSlot, nowMs: number): LiveAdjustment {
  return { windowId: slot.windowId, endMs: nowMs };
}

/** +N min: the current slot ends N minutes later. */
export function extendAdjustment(slot: LiveSlot, minutes = 10): LiveAdjustment {
  return { windowId: slot.windowId, endMs: slot.endMs + minutes * 60_000 };
}

/** A plan can go live only on its own night (or when it follows the global date). */
export function canGoLive(
  plan: { nightOf?: string | null; archived?: boolean },
  tonight: string,
): boolean {
  return !plan.archived && (!plan.nightOf || plan.nightOf === tonight);
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const targetLabel = (s: LiveSlot) => (s.filter ? `${s.name} (${s.filter})` : s.name);

/** The title and body of the visible notification (and the live card's lines) for a status. */
export function formatLiveStatus(
  status: LiveStatus,
  t: Translate,
  clock: (ms: number) => string,
): { title: string; body: string } {
  switch (status.kind) {
    case 'before-start':
      return {
        title: t('live.status.startsAt', { time: clock(status.next.startMs) }),
        body: t('live.status.first', { name: targetLabel(status.next) }),
      };
    case 'active':
      return {
        title: t('live.status.current', {
          name: targetLabel(status.current),
          time: clock(status.current.endMs),
        }),
        body: status.next
          ? t('live.status.next', {
              name: targetLabel(status.next),
              time: clock(status.next.startMs),
            })
          : t('live.status.last'),
      };
    case 'gap':
      return {
        title: t('live.status.gap', { time: clock(status.next.startMs) }),
        body: t('live.status.next', {
          name: targetLabel(status.next),
          time: clock(status.next.startMs),
        }),
      };
    case 'finished':
      return { title: t('live.status.finished'), body: t('live.status.finishedBody') };
  }
}

/** The title and body of an alert notification. */
export function formatLiveAlert(
  alert: LiveAlert,
  t: Translate,
  clock: (ms: number) => string,
): { title: string; body: string } {
  const s = alert.slot!;
  const n = alert.next;
  switch (alert.kind) {
    case 'start':
      return {
        title: t('live.alert.start', { name: targetLabel(s) }),
        body: t('live.alert.until', { time: clock(s.endMs) }),
      };
    case 'end':
      return {
        title: t('live.alert.end', { name: targetLabel(s) }),
        body: formatLiveStatus(alert.status, t, clock).title,
      };
    case 'switch':
      return {
        title: t('live.alert.switch', { name: targetLabel(n!) }),
        body: t('live.alert.switchBody', { prev: s.name, time: clock(n!.endMs) }),
      };
    case 'filter':
      return {
        title: t('live.alert.filter', { filter: n!.filter ?? t('live.noFilter') }),
        body: t('live.alert.until', { time: clock(n!.endMs) }),
      };
    case 'reminder':
      return {
        title: t('live.alert.reminder', {
          name: targetLabel(s),
          minutes: Math.round((s.endMs - alert.atMs) / 60_000),
        }),
        body: formatLiveStatus(alert.status, t, clock).body,
      };
    case 'meridian':
      return {
        title: t('live.alert.meridian', { name: s.name, time: clock(alert.transitMs!) }),
        body: t('live.alert.meridianBody'),
      };
    case 'finished':
      return { title: t('live.status.finished'), body: t('live.status.finishedBody') };
  }
}

/** The buttons of the visible notification: Skip and +10 min only while a target is being imaged. */
export type LiveAction = 'skip' | 'extend' | 'stop';

export function liveActions(status: LiveStatus): LiveAction[] {
  if (status.kind === 'finished') return [];
  return status.kind === 'active' ? ['skip', 'extend', 'stop'] : ['stop'];
}

/** The visible notification's text and buttons. */
export interface LiveStatusText {
  title: string;
  body: string;
  actions: LiveAction[];
}

/** One alert as the platform shows it, with the visible notification from that moment on. */
export interface LiveNotice {
  kind: LiveAlertKind;
  atMs: number;
  title: string;
  body: string;
  /** The visible notification from `atMs` on; when `finished` it can be swiped away and has no button. */
  status: LiveStatusText;
  finished: boolean;
}

/** What a platform does with the alerts: the phone schedules them as notifications, a browser raises them while open. */
export interface LiveAlertsPort {
  /** Replace everything scheduled: `status` shows now, `notices` are the alerts to come. */
  sync(planId: string, status: LiveStatusText, notices: LiveNotice[]): Promise<void>;
  /** Remove the visible notification and everything scheduled. */
  clear(): Promise<void>;
}

/** "2 h 22" or "35 min": the time left on the current target. */
export function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** The live card's lines (board "Plan, en direct"): a title, the line under it, a progress in [0,1] while a target
 * is imaged, and what comes next. */
export interface LiveCard {
  title: string;
  /** The clock time inside `title`, drawn in figures (null when the title is a target's name). */
  line: string;
  progress: number | null;
  next: string;
}

export function liveCard(
  status: LiveStatus,
  slots: readonly LiveSlot[],
  nowMs: number,
  t: Translate,
  clock: (ms: number) => string,
): LiveCard {
  const next = (s: LiveSlot | null) =>
    s ? t('live.nextAt', { name: targetLabel(s), time: clock(s.startMs) }) : '';
  switch (status.kind) {
    case 'before-start':
      return {
        title: t('live.status.startsAt', { time: clock(status.next.startMs) }),
        line: t('live.status.first', { name: targetLabel(status.next) }),
        progress: null,
        next: '',
      };
    case 'active': {
      const c = status.current;
      return {
        title: targetLabel(c),
        line: t('live.untilRemaining', {
          time: clock(c.endMs),
          left: formatRemaining(c.endMs - nowMs),
        }),
        progress: Math.min(1, Math.max(0, (nowMs - c.startMs) / (c.endMs - c.startMs))),
        next: next(status.next),
      };
    }
    case 'gap': {
      const prev = [...slots].reverse().find((s) => s.endMs <= nowMs);
      return {
        title: t('live.status.gap', { time: clock(status.next.startMs) }),
        line: prev ? t('live.prevDone', { name: prev.name }) : '',
        progress: null,
        next: next(status.next),
      };
    }
    case 'finished':
      return { title: t('live.status.finished'), line: '', progress: null, next: '' };
  }
}
