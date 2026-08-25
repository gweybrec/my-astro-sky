import { describe, it, expect, beforeEach } from 'vitest';
import {
  trajectoryWindow,
  computeTrajectory,
  resetTrajectoryCache,
} from '../../src/sky-trajectory';

// Observer: mid-northern latitude (Chamonix-ish), so declination alone decides
// circumpolar vs rise/set.
const LAT = 45.9;
const LON = 6.9;

/** Polaris — permanently up at LAT. */
const POLARIS = { ra: 37.95, dec: 89.26 };
/** Canopus — permanently down at LAT (dec far enough south). */
const CANOPUS = { ra: 95.99, dec: -52.7 };
/** M31 — rises and sets at LAT. */
const M31 = { ra: 10.68, dec: 41.27 };

describe('trajectoryWindow', () => {
  it('anchors an afternoon instant to the same day at local noon', () => {
    const { start, end } = trajectoryWindow(new Date(2026, 2, 14, 14, 37, 12, 345));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(14);
    expect(start.getHours()).toBe(12);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(12);
  });

  it('anchors an after-midnight instant to the PREVIOUS day (same night)', () => {
    const { start, end } = trajectoryWindow(new Date(2026, 2, 15, 3, 5));
    expect(start.getDate()).toBe(14);
    expect(start.getHours()).toBe(12);
    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(12);
  });

  it('puts 23:59 and the 00:30 that follows it in the same window', () => {
    const a = trajectoryWindow(new Date(2026, 5, 10, 23, 59));
    const b = trajectoryWindow(new Date(2026, 5, 11, 0, 30));
    expect(a.start.getTime()).toBe(b.start.getTime());
  });

  it('handles a month/year boundary', () => {
    const { start } = trajectoryWindow(new Date(2027, 0, 1, 2, 0));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(11);
    expect(start.getDate()).toBe(31);
  });
});

describe('computeTrajectory', () => {
  beforeEach(() => {
    resetTrajectoryCache();
  });

  it('samples the whole window, end-inclusive, ordered in time', () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { start, end } = trajectoryWindow(simDate);
    const { samples } = computeTrajectory(M31.ra, M31.dec, LAT, LON, simDate);

    expect(samples[0].time.getTime()).toBe(start.getTime());
    expect(samples[samples.length - 1].time.getTime()).toBe(end.getTime());
    // A day at a 2-minute step.
    expect(samples.length).toBeGreaterThan(700);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].time.getTime()).toBeGreaterThan(samples[i - 1].time.getTime());
    }
  });

  it('keeps below-horizon samples (the draw pass pen-lifts, so crossings stay put)', () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { samples } = computeTrajectory(M31.ra, M31.dec, LAT, LON, simDate);
    expect(samples.some((s) => s.altDeg < 0)).toBe(true);
    expect(samples.some((s) => s.altDeg > 0)).toBe(true);
  });

  it('a circumpolar object never dips below the horizon', () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { samples, markers } = computeTrajectory(POLARIS.ra, POLARIS.dec, LAT, LON, simDate);
    expect(samples.every((s) => s.altDeg > 0)).toBe(true);
    // Up all day → one marker at every even hour of the 24h window.
    expect(markers.length).toBe(12);
  });

  it('an object that never rises produces no markers', () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { samples, markers } = computeTrajectory(CANOPUS.ra, CANOPUS.dec, LAT, LON, simDate);
    expect(samples.every((s) => s.altDeg < 0)).toBe(true);
    expect(markers).toEqual([]);
  });

  it('markers sit on even local hours, above the horizon, in time order', () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { start, end } = trajectoryWindow(simDate);
    const { markers } = computeTrajectory(M31.ra, M31.dec, LAT, LON, simDate);

    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(m.time.getHours() % 2).toBe(0);
      expect(m.time.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(m.time.getTime()).toBeLessThan(end.getTime());
      expect(m.altDeg).toBeGreaterThan(1);
      expect(m.azDeg).toBeGreaterThanOrEqual(0);
      expect(m.azDeg).toBeLessThan(360);
      // Zero-padded two-digit hour, whatever the language's separator.
      expect(m.label).toContain(String(m.time.getHours()).padStart(2, '0'));
    }
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].time.getTime()).toBeGreaterThan(markers[i - 1].time.getTime());
    }
  });

  it("a marker's alt/az agrees with the sampled curve at the same instant", () => {
    const simDate = new Date(2026, 2, 14, 22, 0);
    const { samples, markers } = computeTrajectory(M31.ra, M31.dec, LAT, LON, simDate);
    const m = markers[0];
    const nearest = samples.reduce((best, s) =>
      Math.abs(s.time.getTime() - m.time.getTime()) <
      Math.abs(best.time.getTime() - m.time.getTime())
        ? s
        : best,
    );
    // Samples are 2 minutes apart, so they land exactly on the hour.
    expect(nearest.time.getTime()).toBe(m.time.getTime());
    expect(nearest.altDeg).toBeCloseTo(m.altDeg, 6);
    expect(nearest.azDeg).toBeCloseTo(m.azDeg, 6);
  });
});

describe('computeTrajectory memo', () => {
  beforeEach(() => {
    resetTrajectoryCache();
  });

  it('returns the identical object while nothing relevant changes', () => {
    const a = computeTrajectory(M31.ra, M31.dec, LAT, LON, new Date(2026, 2, 14, 22, 0));
    // Same night, clock advanced — the window is day-anchored, so this must hit the memo.
    const b = computeTrajectory(M31.ra, M31.dec, LAT, LON, new Date(2026, 2, 15, 1, 30));
    expect(b).toBe(a);
  });

  it('recomputes when the simulated day, the target or the observer changes', () => {
    const base = computeTrajectory(M31.ra, M31.dec, LAT, LON, new Date(2026, 2, 14, 22, 0));

    const nextNight = computeTrajectory(M31.ra, M31.dec, LAT, LON, new Date(2026, 2, 15, 22, 0));
    expect(nextNight).not.toBe(base);

    const otherTarget = computeTrajectory(
      POLARIS.ra,
      POLARIS.dec,
      LAT,
      LON,
      new Date(2026, 2, 15, 22, 0),
    );
    expect(otherTarget).not.toBe(nextNight);

    const otherObserver = computeTrajectory(
      POLARIS.ra,
      POLARIS.dec,
      -LAT,
      LON,
      new Date(2026, 2, 15, 22, 0),
    );
    expect(otherObserver).not.toBe(otherTarget);
  });
});
