export function formatArcmin(arcmin: number | null): string {
  if (arcmin === null) return '—';
  if (arcmin >= 60) return `${(arcmin / 60).toFixed(1)}°`;
  return `${arcmin.toFixed(1)}'`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_START_MIN = 8 * 60; // 08:00 — start of excluded daytime range
const DAY_END_MIN = 18 * 60; // 18:00 — end of excluded daytime range

export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Snap a `HH:MM` time to the nearest 30-minute step, then push it out of
 * daytime hours (08:00–18:00, exclusive) to the nearer night boundary.
 *
 * Used only to self-heal a pre-existing persisted value (e.g. from an older
 * app version) on load — new selections always come from {@link NIGHT_TIME_OPTIONS}
 * via a custom dropdown, not a native `<input type="time">`, whose own
 * picker/step/min-max handling turned out to be unreliable across
 * interaction paths (its scroll-wheel popup ignores `step` entirely, and
 * opening it on an empty field can commit the literal current wall-clock
 * time unaligned to any step).
 */
export function snapToObservationTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let total = (((h * 60 + m) % 1440) + 1440) % 1440;
  total = (Math.round(total / 30) * 30) % 1440;
  if (total > DAY_START_MIN && total < DAY_END_MIN) {
    total = total - DAY_START_MIN <= DAY_END_MIN - total ? DAY_START_MIN : DAY_END_MIN;
  }
  return minutesToHHMM(total);
}

/** All valid observation-window times: 18:00–23:30, then 00:00–08:00, every 30 min. */
export const NIGHT_TIME_OPTIONS: string[] = [
  ...Array.from({ length: (1440 - DAY_END_MIN) / 30 }, (_, i) =>
    minutesToHHMM(DAY_END_MIN + i * 30),
  ),
  ...Array.from({ length: DAY_START_MIN / 30 + 1 }, (_, i) => minutesToHHMM(i * 30)),
];

/** A local time as `HH:MM` on the 24-hour clock, whatever the device's locale. */
export function formatClock24(d: Date): string {
  return minutesToHHMM(d.getHours() * 60 + d.getMinutes());
}
