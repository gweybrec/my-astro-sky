import { describe, it, expect } from 'vitest';
import { traceHorizonAngles, selectSkylineSummits } from '../../server/horizon';
import type { OverpassPeak } from '../../server/overpass';

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

describe('traceHorizonAngles', () => {
  it('gives a flat (floor) horizon over flat terrain', () => {
    const alts = traceHorizonAngles(() => 0, 45, 6, {
      radiusM: 5000,
      obsElev: 1.7,
      azStepDeg: 90,
    });
    // Flat ground below the eye → all rays point slightly down, clamped to floor.
    for (const a of alts) expect(a).toBeLessThanOrEqual(0);
  });

  it('detects a wall of known height/distance at the expected angle', () => {
    // A 300 m-tall ridge due East (az 90), 3 km away. Observer at ground (eye 0).
    const ridgeLon = 6 + 3000 / (EARTH_R * Math.cos(45 * DEG)) / DEG;
    const elevationAt = (_lat: number, lon: number) => (lon >= ridgeLon - 0.002 ? 300 : 0);
    const alts = traceHorizonAngles(elevationAt, 45, 6, {
      radiusM: 5000,
      obsElev: 0,
      azStepDeg: 1,
      stepM: 20,
    });
    // Expected angle ≈ atan((300 - curvatureDrop)/3000). Curvature drop at 3km ≈ 0.6 m.
    const drop = (3000 * 3000) / (2 * (EARTH_R / (1 - 0.13)));
    const expected = Math.atan2(300 - drop, 3000) / DEG;
    expect(alts[90]).toBeGreaterThan(expected - 1.5);
    expect(alts[90]).toBeLessThan(expected + 1.5);
    // The opposite direction (West) sees only flat ground → near the floor.
    expect(alts[270]).toBeLessThanOrEqual(0);
  });

  it('a higher observer sees a lower horizon over the same wall', () => {
    const ridgeLon = 6 + 3000 / (EARTH_R * Math.cos(45 * DEG)) / DEG;
    const elevationAt = (_lat: number, lon: number) => (lon >= ridgeLon - 0.002 ? 300 : 0);
    const low = traceHorizonAngles(elevationAt, 45, 6, { radiusM: 5000, obsElev: 0, stepM: 20 });
    const high = traceHorizonAngles(elevationAt, 45, 6, { radiusM: 5000, obsElev: 200, stepM: 20 });
    expect(high[90]).toBeLessThan(low[90]);
  });

  it('clamps below-observer terrain to the floor rather than going arbitrarily low', () => {
    const alts = traceHorizonAngles(() => -100, 45, 6, {
      radiusM: 5000,
      obsElev: 500,
      azStepDeg: 90,
    });
    for (const a of alts) expect(a).toBeGreaterThanOrEqual(-5);
  });
});

describe('selectSkylineSummits', () => {
  const obs = { lat: 45, lon: 6, obsElev: 1000 };
  const cosLat = Math.cos(obs.lat * DEG);

  // Place a peak at a given azimuth/distance/elevation from the observer.
  const place = (name: string, azDeg: number, distM: number, ele: number): OverpassPeak => {
    const northM = distM * Math.cos(azDeg * DEG);
    const eastM = distM * Math.sin(azDeg * DEG);
    return {
      name,
      lat: obs.lat + northM / (DEG * EARTH_R),
      lon: obs.lon + eastM / (DEG * EARTH_R * cosLat),
      eleM: ele,
    };
  };

  // Flat crest of 8° in every direction (so a peak's azimuth doesn't change the crest).
  const alts = new Array(360).fill(8);

  it('keeps skyline peaks, drops hidden ones, dedups by azimuth, sets altDeg to the crest', () => {
    const peaks = [
      place('East', 90, 3000, 1422), // angle ≈ 8° → on the crest
      place('EastHi', 91, 3000, 1500), // angle ≈ 9.5°, within 2° of East → dedup keeps this
      place('SouthHidden', 180, 3000, 1100), // angle ≈ 1.9° ≪ crest 8° → hidden, dropped
      place('West', 270, 3000, 1422), // separate azimuth → kept
    ];
    const summits = selectSkylineSummits(peaks, alts, obs, () => 0, { radiusM: 40000 });

    const names = summits.map((s) => s.name);
    expect(names).toContain('West');
    expect(names).toContain('EastHi');
    expect(names).not.toContain('East'); // merged into the taller EastHi
    expect(names).not.toContain('SouthHidden'); // hidden behind the crest
    expect(summits).toHaveLength(2);
    // Dots sit on the drawn silhouette (crest), and report the peak's real height.
    for (const s of summits) expect(s.altDeg).toBeCloseTo(8, 5);
    expect(summits.find((s) => s.name === 'EastHi')!.elevationM).toBe(1500);
  });

  it('falls back to the DEM elevation when a peak has no ele tag', () => {
    const peaks = [{ ...place('NoEle', 90, 3000, 0), eleM: null }];
    // DEM says this spot is 1422 m → angle ≈ 8° → on the crest → kept.
    const summits = selectSkylineSummits(peaks, alts, obs, () => 1422, { radiusM: 40000 });
    expect(summits).toHaveLength(1);
    expect(summits[0].elevationM).toBe(1422);
  });

  it('caps the number of summits to the tallest N', () => {
    const peaks = Array.from(
      { length: 10 },
      (_, i) => place(`P${i}`, i * 30, 3000, 1422 + i), // spread around the circle, on the crest
    );
    const summits = selectSkylineSummits(peaks, alts, obs, () => 0, {
      radiusM: 40000,
      maxSummits: 3,
    });
    expect(summits).toHaveLength(3);
  });
});
