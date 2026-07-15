import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useCanvasStore } from './canvas';
import { useDisplayStore } from './display';
import {
  loadSkyTimeSettings,
  saveSkyTimeSettings,
  RATE_LADDER,
  type SkyTimeSettings,
} from '../sky-time-settings';
import { twilightWindow } from '../astro-time';

// Read-only, one-shot default seed for the location fields — see seedLocationIfNeeded().
// Not imported from targets-view.ts to avoid coupling the two features; this store never
// writes back to it, so the two locations can diverge after the first seed.
const TARGETS_PREFS_KEY = 'targets-prefs-v3';

function seedLocationFromTargetsPrefs(): { lat: number | null; lon: number | null } {
  try {
    const raw = localStorage.getItem(TARGETS_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { lat: parsed.lat ?? null, lon: parsed.lon ?? null };
    }
  } catch {
    /* ignore */
  }
  return { lat: null, lon: null };
}

// Coarse cadence: Moon/horizon motion is slow, so this only needs to be smooth enough
// for a readout, not a 60fps animation.
const TICK_MS = 500;

export const useSkyTimeStore = defineStore('sky-time', () => {
  const canvasStore = useCanvasStore();
  const s = loadSkyTimeSettings();

  // ─── State ───────────────────────────────────────────────────────────────────
  const mode = ref<'live' | 'date'>(s.mode);
  const simDate = ref<Date>(new Date(s.simDateISO));
  const lat = ref<number | null>(s.lat);
  const lon = ref<number | null>(s.lon);
  const timeRateIndex = ref(s.timeRateIndex);
  const timeRateSign = ref<1 | -1>(s.timeRateSign);
  const paused = ref(s.paused);
  const lastSyncEpochMs = ref(s.lastSyncEpochMs);
  const showMoon = ref(s.showMoon);
  const showAzimuthGrid = ref(s.showAzimuthGrid);
  const showCardinalPoints = ref(s.showCardinalPoints);
  const localSkyMode = ref(s.localSkyMode);

  let hasSeededLocation = lat.value !== null || lon.value !== null;
  // Reset every fresh page load/app launch (module-scope-per-store-instance, not persisted) —
  // see activateDateMode() below for why the very first date-mode activation of a session is
  // special-cased to a clean "now, 1x" baseline rather than resuming stale persisted state.
  let hasActivatedDateModeThisSession = false;
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  // Index 0 is the dial's resting pivot — 1x, not a stop. Explicit pause/resume is the
  // separate `paused` flag below, so the dial itself never needs a "stopped" rung.
  const effectiveRate = computed(
    () =>
      timeRateSign.value * (timeRateIndex.value === 0 ? 1 : RATE_LADDER[timeRateIndex.value - 1]),
  );

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function snap(): SkyTimeSettings {
    return {
      mode: mode.value,
      simDateISO: simDate.value.toISOString(),
      lat: lat.value,
      lon: lon.value,
      timeRateIndex: timeRateIndex.value,
      timeRateSign: timeRateSign.value,
      paused: paused.value,
      lastSyncEpochMs: lastSyncEpochMs.value,
      showMoon: showMoon.value,
      showAzimuthGrid: showAzimuthGrid.value,
      showCardinalPoints: showCardinalPoints.value,
      localSkyMode: localSkyMode.value,
    };
  }

  function persist() {
    saveSkyTimeSettings(snap());
  }

  function updateTicker() {
    const shouldTick = mode.value === 'date' && !paused.value;
    if (shouldTick && tickHandle === null) {
      tickHandle = setInterval(() => {
        simDate.value = new Date(simDate.value.getTime() + effectiveRate.value * TICK_MS);
        lastSyncEpochMs.value = Date.now();
        canvasStore.skyMap?.setSimDate(simDate.value);
        persist();
      }, TICK_MS);
    } else if (!shouldTick && tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  /**
   * Runs whenever date mode becomes active (entering it this session, or the store
   * booting up already persisted into it). The very first activation of a session
   * discards whatever was persisted and starts clean at "now", 1x, unpaused — so
   * reopening the app days later never resumes a stale warped clock unexpectedly.
   * Every later activation instead fast-forwards simDate by the real time elapsed
   * since it was last known-accurate, at the persisted rate — so leaving date mode
   * (or closing the app) doesn't freeze the clock, it keeps flowing in the background
   * exactly as if the session had stayed on this whole time, unless explicitly paused.
   */
  function activateDateMode() {
    const now = Date.now();
    if (!hasActivatedDateModeThisSession) {
      hasActivatedDateModeThisSession = true;
      simDate.value = new Date(now);
      timeRateIndex.value = 0;
      timeRateSign.value = 1;
      paused.value = false;
    } else if (!paused.value) {
      const elapsedMs = now - lastSyncEpochMs.value;
      if (elapsedMs > 0) {
        simDate.value = new Date(simDate.value.getTime() + elapsedMs * effectiveRate.value);
      }
    }
    lastSyncEpochMs.value = now;
    canvasStore.skyMap?.setSimDate(simDate.value);
  }

  if (mode.value === 'date') activateDateMode();

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setMode(next: 'live' | 'date') {
    if (next === mode.value) return;
    // Local-sky mode needs date mode + a location; leaving date mode breaks that
    // precondition, so disable it first (updates the persisted flag too).
    if (next !== 'date' && localSkyMode.value) setLocalSkyMode(false);
    mode.value = next;
    if (next === 'date') activateDateMode();
    // showMoon and showAzimuthGrid are intentionally left as-is: switching back to
    // live and then back to date within the same session should find these exactly
    // where they were left, not reset — the sky-map render loop is what hides the
    // moon/azimuth grid while in live mode (they only make sense relative to a
    // simulated date/time), not this store.
    canvasStore.skyMap?.setSkyTimeMode(mode.value);
    updateTicker();
    persist();
  }

  function toggleMode() {
    setMode(mode.value === 'live' ? 'date' : 'live');
  }

  function setSimDate(date: Date) {
    simDate.value = date;
    lastSyncEpochMs.value = Date.now();
    canvasStore.skyMap?.setSimDate(date);
    persist();
  }

  function setLocation(newLat: number | null, newLon: number | null) {
    if ((newLat === null || newLon === null) && localSkyMode.value) setLocalSkyMode(false);
    lat.value = newLat;
    lon.value = newLon;
    hasSeededLocation = true;
    canvasStore.skyMap?.setObserverLocation(newLat, newLon);
    persist();
  }

  /**
   * The zenith-centered "local sky" view — only meaningful in date mode with an
   * observer location set (alt/az is undefined otherwise); rejected otherwise.
   * Hemisphere/border-lat have no effect while this is active (see
   * DisplayControlsSection.vue), but the Stereo/Fisheye radial-style pill stays
   * independent — it now picks the radial falloff around the zenith instead of
   * the celestial pole.
   */
  function setLocalSkyMode(v: boolean) {
    if (v && !(mode.value === 'date' && lat.value !== null && lon.value !== null)) return;
    localSkyMode.value = v;
    const sm = canvasStore.skyMap;
    const ov = canvasStore.overlay;
    const displayStore = useDisplayStore();
    sm?.setLocalSkyMode(v);
    ov?.setBorderParams(displayStore.hemisphere, displayStore.borderLatDeg);
    ov?.updateTransforms();
    persist();
  }

  /**
   * Pre-fills lat/lon from the Targets tab's saved location, once, the first time the
   * location popover is opened with nothing set yet. Read-only, one-shot — this feature
   * does not stay in sync with Targets afterwards.
   */
  function seedLocationIfNeeded() {
    if (hasSeededLocation) return;
    hasSeededLocation = true;
    const seeded = seedLocationFromTargetsPrefs();
    if (seeded.lat !== null || seeded.lon !== null) {
      lat.value = seeded.lat;
      lon.value = seeded.lon;
      canvasStore.skyMap?.setObserverLocation(lat.value, lon.value);
      persist();
    }
  }

  function setShowMoon(v: boolean) {
    showMoon.value = v;
    canvasStore.skyMap?.setShowMoon(v);
    persist();
  }

  function setShowAzimuthGrid(v: boolean) {
    showAzimuthGrid.value = v;
    canvasStore.skyMap?.setShowAzimuthGrid(v);
    persist();
  }

  function setShowCardinalPoints(v: boolean) {
    showCardinalPoints.value = v;
    canvasStore.skyMap?.setShowCardinalPoints(v);
    persist();
  }

  /**
   * The rate is a single signed dial: forward (l) always moves it one ladder step
   * toward +∞, backward (j) always moves it one step toward -∞ — so from +10,
   * pressing backward slows to +5 (not an immediate reverse-to--1), and continuing
   * to press the same key climbs the ladder in that direction. Index 0 is the dial's
   * resting pivot (1x, not a stop — see `paused` for that), so the very first press
   * from rest jumps straight to the first ladder rung (±2), skipping ±1 entirely —
   * that's what the 1x baseline already looks like, so warping to it would be a no-op.
   */
  function stepRateForward() {
    if (mode.value !== 'date') setMode('date');
    if (timeRateSign.value === -1 && timeRateIndex.value > 0) {
      timeRateIndex.value -= 1;
      if (timeRateIndex.value === 0) timeRateSign.value = 1;
    } else {
      timeRateSign.value = 1;
      timeRateIndex.value = Math.min(timeRateIndex.value + 1, RATE_LADDER.length);
    }
    updateTicker();
    persist();
  }

  function stepRateBackward() {
    if (mode.value !== 'date') setMode('date');
    if (timeRateSign.value === 1 && timeRateIndex.value > 0) {
      timeRateIndex.value -= 1;
      if (timeRateIndex.value === 0) timeRateSign.value = -1;
    } else {
      timeRateSign.value = -1;
      timeRateIndex.value = Math.min(timeRateIndex.value + 1, RATE_LADDER.length);
    }
    updateTicker();
    persist();
  }

  /** The "x1" button: resets the dial to the 1x baseline and unpauses, regardless of
   *  wherever the dial/pause state was left — a one-click way back to normal playback. */
  function setRateNormal() {
    if (mode.value !== 'date') setMode('date');
    timeRateIndex.value = 0;
    timeRateSign.value = 1;
    paused.value = false;
    updateTicker();
    persist();
  }

  /** Video-player-style play/pause: freezes/resumes simDate in place without touching
   *  the selected rate, so resuming continues at whatever speed was already dialed in. */
  function togglePaused() {
    if (mode.value !== 'date') setMode('date');
    paused.value = !paused.value;
    // Resuming re-syncs to "now" so a later mode switch doesn't treat the paused
    // interval itself as elapsed time to catch up on (see activateDateMode()).
    if (!paused.value) lastSyncEpochMs.value = Date.now();
    updateTicker();
    persist();
  }

  /** Jumps the simulated date/time back to "now" and resets the dial to the 1x
   *  baseline, unpaused — a full reset of both the clock and its playback state. */
  function resetToNow() {
    simDate.value = new Date();
    timeRateIndex.value = 0;
    timeRateSign.value = 1;
    paused.value = false;
    lastSyncEpochMs.value = Date.now();
    canvasStore.skyMap?.setSimDate(simDate.value);
    updateTicker();
    persist();
  }

  /** Fallback when no observer location is set: a fixed, unremarkable "evening" hour. */
  function defaultEveningTime(base: Date): Date {
    const d = new Date(base);
    d.setHours(21, 0, 0, 0);
    return d;
  }

  /**
   * Jumps to the evening of the currently selected day, keeping the calendar date and
   * only moving the time-of-day. With an observer location set, this is the real
   * astronomical dusk (twilightWindow, already used by the Targets night-planning
   * feature) — otherwise it falls back to a fixed clock hour.
   */
  function jumpToEvening() {
    if (mode.value !== 'date') setMode('date');
    let evening: Date;
    if (lat.value !== null && lon.value !== null) {
      const win = twilightWindow(simDate.value, lat.value, lon.value);
      evening = win ? win.start : defaultEveningTime(simDate.value);
    } else {
      evening = defaultEveningTime(simDate.value);
    }
    simDate.value = evening;
    lastSyncEpochMs.value = Date.now();
    canvasStore.skyMap?.setSimDate(evening);
    persist();
  }

  return {
    // state
    mode,
    simDate,
    lat,
    lon,
    timeRateIndex,
    timeRateSign,
    paused,
    showMoon,
    showAzimuthGrid,
    showCardinalPoints,
    localSkyMode,
    effectiveRate,
    // actions
    setMode,
    toggleMode,
    setSimDate,
    setLocation,
    seedLocationIfNeeded,
    setShowMoon,
    setShowAzimuthGrid,
    setShowCardinalPoints,
    setLocalSkyMode,
    stepRateForward,
    stepRateBackward,
    setRateNormal,
    togglePaused,
    resetToNow,
    jumpToEvening,
  };
});
