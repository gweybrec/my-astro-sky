import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useCanvasStore } from './canvas';
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
  const showMoon = ref(s.showMoon);
  const showAzimuthGrid = ref(s.showAzimuthGrid);

  let hasSeededLocation = lat.value !== null || lon.value !== null;
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  const effectiveRate = computed(() =>
    timeRateIndex.value === 0 ? 0 : timeRateSign.value * RATE_LADDER[timeRateIndex.value - 1],
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
      showMoon: showMoon.value,
      showAzimuthGrid: showAzimuthGrid.value,
    };
  }

  function persist() {
    saveSkyTimeSettings(snap());
  }

  function updateTicker() {
    const shouldTick = mode.value === 'date' && effectiveRate.value !== 0;
    if (shouldTick && tickHandle === null) {
      tickHandle = setInterval(() => {
        simDate.value = new Date(simDate.value.getTime() + effectiveRate.value * TICK_MS);
        canvasStore.skyMap?.setSimDate(simDate.value);
        persist();
      }, TICK_MS);
    } else if (!shouldTick && tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setMode(next: 'live' | 'date') {
    if (next === mode.value) return;
    mode.value = next;
    // simDate, showMoon and showAzimuthGrid are intentionally left as-is: switching
    // back to live and then back to date within the same session should find these
    // exactly where they were left, not reset — the sky-map render loop is what hides
    // the moon/azimuth grid while in live mode (they only make sense relative to a
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
    canvasStore.skyMap?.setSimDate(date);
    persist();
  }

  function setLocation(newLat: number | null, newLon: number | null) {
    lat.value = newLat;
    lon.value = newLon;
    hasSeededLocation = true;
    canvasStore.skyMap?.setObserverLocation(newLat, newLon);
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

  /**
   * The rate is a single signed dial: forward (l) always moves it one ladder step
   * toward +∞, backward (j) always moves it one step toward -∞ — so from +10,
   * pressing backward slows to +5 (not an immediate reverse-to--1), and continuing
   * to press the same key climbs the ladder in that direction. The very first press
   * from a stop jumps straight to the first ladder rung (±2), skipping ±1 — that's
   * what live mode already looks like, so warping at 1x wouldn't feel like anything.
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

  /** Freezes simDate where it currently is — does NOT reset to "now". */
  function stopTime() {
    if (mode.value !== 'date') setMode('date');
    timeRateIndex.value = 0;
    updateTicker();
    persist();
  }

  /** Jumps the simulated date/time back to "now", independent of the rate/pause state. */
  function resetToNow() {
    simDate.value = new Date();
    timeRateIndex.value = 0;
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
    showMoon,
    showAzimuthGrid,
    effectiveRate,
    // actions
    setMode,
    toggleMode,
    setSimDate,
    setLocation,
    seedLocationIfNeeded,
    setShowMoon,
    setShowAzimuthGrid,
    stepRateForward,
    stepRateBackward,
    stopTime,
    resetToNow,
    jumpToEvening,
  };
});
