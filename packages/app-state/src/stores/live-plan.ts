import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { storage } from '@myastrosky/core/platform/storage';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Plan } from '@myastrosky/core/domain/plans';
import type { PlanNight } from '@myastrosky/core/targets/plan';
import { tonightISO } from '@myastrosky/core/targets/plan';
import {
  DEFAULT_LIVE_OPTIONS,
  buildLiveAlerts,
  buildLiveSchedule,
  canGoLive,
  extendAdjustment,
  formatLiveAlert,
  formatLiveStatus,
  liveStatusAt,
  skipAdjustment,
  liveActions,
  type LiveAlertsPort,
  type LiveNotice,
  type LiveOptions,
  type LivePlanState,
  type LiveStatus,
  type LiveStatusText,
} from '@myastrosky/core/targets/live-plan';
import { usePlansStore } from './plans';

export type { LiveAlertsPort, LiveNotice } from '@myastrosky/core/targets/live-plan';

export interface LivePlanDeps {
  /** The plan's night on this platform (its location and date settings, its catalogue lookups). */
  resolveNight(plan: Plan): PlanNight | null;
  alerts: LiveAlertsPort;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** HH:MM in the app's clock format. */
  clock(ms: number): string;
}

const STORAGE_KEY = 'livePlan';
const TICK_MS = 15_000;

function loadState(): LivePlanState | null {
  try {
    const raw = storage().get(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LivePlanState;
    return s?.planId ? { ...s, options: { ...DEFAULT_LIVE_OPTIONS, ...s.options } } : null;
  } catch {
    return null;
  }
}

/**
 * The plan followed live tonight: what is imaged now, what comes next, Skip / +10 min, and the alerts handed to the
 * platform. One plan at a time; the state is kept on the device so a restart picks it up again.
 */
export const useLivePlanStore = defineStore('live-plan', () => {
  const plans = usePlansStore();
  const state = ref<LivePlanState | null>(loadState());
  const now = ref(Date.now());
  /** The last options used, offered again at the next start. */
  const lastOptions = ref<LiveOptions>(state.value?.options ?? { ...DEFAULT_LIVE_OPTIONS });
  let deps: LivePlanDeps | null = null;
  const installed = ref(false);
  let tick: ReturnType<typeof setInterval> | null = null;
  let boundary: ReturnType<typeof setTimeout> | null = null;

  const plan = computed(() =>
    state.value ? (plans.plans.find((p) => p.id === state.value!.planId) ?? null) : null,
  );
  const night = computed(() =>
    installed.value && plan.value && deps ? deps.resolveNight(plan.value) : null,
  );
  const slots = computed(() =>
    plan.value && night.value
      ? buildLiveSchedule(plan.value, night.value, state.value!.adjustments)
      : [],
  );
  const alerts = computed(() =>
    night.value && state.value
      ? buildLiveAlerts(slots.value, state.value.options, night.value.loc.lonDeg)
      : [],
  );
  const status = computed(() => liveStatusAt(slots.value, now.value));
  const isLive = computed(() => !!state.value);
  /** The plan has ended while live: the app asks whether to archive it. */
  const askArchive = computed(
    () =>
      !!state.value && !!plan.value && slots.value.length > 0 && status.value.kind === 'finished',
  );

  function persist(): void {
    try {
      if (state.value) storage().set(STORAGE_KEY, JSON.stringify(state.value));
      else storage().remove(STORAGE_KEY);
    } catch (err) {
      reportError('live-plan: save', err);
    }
  }

  function statusText(st: LiveStatus): LiveStatusText {
    const { title, body } = formatLiveStatus(st, deps!.t, deps!.clock);
    return { title, body, actions: liveActions(st) };
  }

  function notices(): LiveNotice[] {
    if (!deps) return [];
    const { t, clock } = deps;
    return alerts.value
      .filter((a) => a.atMs > Date.now())
      .map((a) => {
        const text = formatLiveAlert(a, t, clock);
        return {
          kind: a.kind,
          atMs: a.atMs,
          title: text.title,
          body: text.body,
          status: statusText(a.status),
          finished: a.kind === 'finished',
        };
      });
  }

  function syncAlerts(): void {
    if (!deps) return;
    const d = deps;
    if (!state.value || !plan.value || askArchive.value) {
      // Stopped, or finished while the app runs (the plan ended, or Passer ended its last target): the notification goes
      // and nothing more is raised; the app asks whether to archive. A plan that finished while the app was closed showed
      // "Plan terminé" until then.
      if (!state.value || askArchive.value)
        d.alerts.clear().catch((err: unknown) => reportError('live-plan: clear', err));
      return;
    }
    // No slot yet: the catalogues (or the plans) are still loading, or the plan has no window. Nothing to show, and what
    // was scheduled before stays.
    if (!slots.value.length) return;
    const st = statusText(liveStatusAt(slots.value, Date.now()));
    d.alerts
      .sync(state.value.planId, st, notices())
      .catch((err: unknown) => reportError('live-plan: schedule alerts', err));
  }

  /** Wake up at the next alert as well as every 15 s, so the live card switches on time. */
  function scheduleBoundary(): void {
    if (boundary) clearTimeout(boundary);
    boundary = null;
    const next = alerts.value.find((a) => a.atMs > Date.now());
    if (!next) return;
    boundary = setTimeout(
      () => {
        now.value = Date.now();
        scheduleBoundary();
      },
      Math.min(next.atMs - Date.now() + 50, 2 ** 31 - 1),
    );
  }

  function startTicker(): void {
    if (tick) return;
    tick = setInterval(() => (now.value = Date.now()), TICK_MS);
  }

  function stopTicker(): void {
    if (tick) clearInterval(tick);
    if (boundary) clearTimeout(boundary);
    tick = boundary = null;
  }

  // Any change of the plan, its windows, its night or the adjustments reschedules every alert.
  watch(
    () => [
      alerts.value.map((a) => `${a.kind}@${a.atMs}`).join(','),
      state.value?.planId,
      installed.value,
      askArchive.value,
    ],
    () => {
      syncAlerts();
      scheduleBoundary();
    },
  );

  // A deleted or archived plan stops being live.
  watch(
    () => [plans.loaded, plan.value?.archived, !!plan.value, state.value?.planId] as const,
    ([loaded, archived, exists]) => {
      if (state.value && loaded && (!exists || archived)) stop();
    },
  );

  /** Called once by the platform at start-up. Picks up a plan left live before a restart. */
  function install(d: LivePlanDeps): void {
    deps = d;
    installed.value = true;
    now.value = Date.now();
    if (state.value) startTicker();
    syncAlerts();
    scheduleBoundary();
  }

  /** Whether the plan can go live tonight (its own night, not archived). */
  function canStart(p: Plan, at: Date = new Date()): boolean {
    return canGoLive(p, tonightISO(at));
  }

  function start(planId: string, options: LiveOptions = lastOptions.value): void {
    state.value = { planId, startedAtMs: Date.now(), adjustments: [], options: { ...options } };
    lastOptions.value = { ...options };
    now.value = Date.now();
    persist();
    startTicker();
  }

  function stop(): void {
    state.value = null;
    persist();
    stopTicker();
    deps?.alerts.clear().catch((err: unknown) => reportError('live-plan: clear', err));
  }

  /** The app came back to the front: the clock may have jumped, and a permission may have changed meanwhile. */
  function refresh(): void {
    now.value = Date.now();
    syncAlerts();
    scheduleBoundary();
  }

  function setOptions(options: LiveOptions): void {
    lastOptions.value = { ...options };
    if (!state.value) return;
    state.value = { ...state.value, options: { ...options } };
    persist();
  }

  function adjust(kind: 'skip' | 'extend'): void {
    const st = liveStatusAt(slots.value, Date.now());
    if (!state.value || st.kind !== 'active') return;
    const adj =
      kind === 'skip' ? skipAdjustment(st.current, Date.now()) : extendAdjustment(st.current);
    state.value = { ...state.value, adjustments: [...state.value.adjustments, adj] };
    now.value = Date.now();
    persist();
  }

  /** The answer to "archive this plan?": either answer ends the live plan. */
  function answerArchive(archive: boolean): void {
    const id = state.value?.planId;
    stop();
    if (archive && id) plans.setPlanArchived(id, true);
  }

  return {
    state,
    now,
    plan,
    night,
    slots,
    alerts,
    status,
    isLive,
    askArchive,
    lastOptions,
    install,
    canStart,
    start,
    stop,
    setOptions,
    refresh,
    skip: () => adjust('skip'),
    extend: () => adjust('extend'),
    answerArchive,
  };
});
