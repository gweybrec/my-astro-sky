/**
 * Astronomy time utilities (Meeus, Astronomical Algorithms).
 * No external dependencies.
 */

const DEG = Math.PI / 180;

/** Convert a JS Date to Julian Day Number */
export function dateToJD(date: Date): number {
  // Julian Day from calendar date — Meeus ch. 7
  let Y = date.getUTCFullYear();
  let M = date.getUTCMonth() + 1; // 1-12
  const D =
    date.getUTCDate() +
    date.getUTCHours() / 24 +
    date.getUTCMinutes() / 1440 +
    date.getUTCSeconds() / 86400;

  if (M <= 2) {
    Y -= 1;
    M += 12;
  }
  const A = Math.trunc(Y / 100);
  const B = 2 - A + Math.trunc(A / 4);
  return Math.trunc(365.25 * (Y + 4716)) + Math.trunc(30.6001 * (M + 1)) + D + B - 1524.5;
}

/** Greenwich Mean Sidereal Time in hours (0-24) */
export function gmstHours(jd: number): number {
  // Meeus eq. 12.4
  const T = (jd - 2451545.0) / 36525.0;
  let theta0 =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  theta0 = ((theta0 % 360) + 360) % 360;
  return theta0 / 15;
}

/** Local Sidereal Time in hours for longitude lon (degrees, East positive) */
export function lstHours(jd: number, lonDeg: number): number {
  return ((gmstHours(jd) + lonDeg / 15 + 24) % 24);
}

// ─── Sun position ──────────────────────────────────────────────────────────

function sunEclipticLongDeg(jd: number): number {
  // Low-precision sun longitude, Meeus ch. 25 simplified
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  return ((lambda % 360) + 360) % 360;
}

/**
 * Sun altitude in degrees above horizon for a given JD, lat, lon.
 */
export function sunAltDeg(jd: number, latDeg: number, lonDeg: number): number {
  const lambda = sunEclipticLongDeg(jd) * DEG;
  const epsilon = 23.439 * DEG; // mean obliquity (approx)

  // Equatorial coords
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  // Hour angle
  const lst = lstHours(jd, lonDeg);
  const ha = ((lst - ra / DEG / 15 + 24) % 24) * 15 * DEG; // radians

  const lat = latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
}

// ─── Twilight window ────────────────────────────────────────────────────────

/**
 * Returns the astronomical twilight window (sun < −18°) for the night
 * starting at `localNoon` (the noon before the observing night).
 * Falls back to nautical (−12°) then civil (−6°) at high latitudes.
 * If the sun never sets (polar day), returns null.
 */
export interface TwilightWindow {
  start: Date;   // astronomical dusk (or best available)
  end: Date;     // astronomical dawn (or best available)
  limitDeg: number; // actual sun elevation used (−18, −12, or −6)
}

export function twilightWindow(
  date: Date,   // any moment on the night's date (local)
  latDeg: number,
  lonDeg: number,
): TwilightWindow | null {
  // We sample the night bracketing local midnight (UTC).
  // Build a JD at noon UTC of the given date as starting point.
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  const jdNoon = dateToJD(noon);

  for (const limitDeg of [-18, -12, -6]) {
    // Sample from noon to noon+24h in 5-min steps → find crossings
    const steps = 24 * 12; // every 5 min
    const dt = 5 / 1440; // 5 minutes in days

    let dusk: Date | null = null;
    let dawn: Date | null = null;

    let prevAlt = sunAltDeg(jdNoon, latDeg, lonDeg);

    for (let i = 1; i <= steps; i++) {
      const jd = jdNoon + i * dt;
      const alt = sunAltDeg(jd, latDeg, lonDeg);
      if (prevAlt > limitDeg && alt <= limitDeg && dusk === null) {
        // setting crossing — interpolate
        const frac = (prevAlt - limitDeg) / (prevAlt - alt);
        const jdCross = jdNoon + (i - 1 + frac) * dt;
        dusk = jdToDate(jdCross);
      }
      if (prevAlt <= limitDeg && alt > limitDeg && dusk !== null && dawn === null) {
        // rising crossing
        const frac = (limitDeg - prevAlt) / (alt - prevAlt);
        const jdCross = jdNoon + (i - 1 + frac) * dt;
        dawn = jdToDate(jdCross);
      }
      prevAlt = alt;
    }

    if (dusk && dawn) {
      return { start: dusk, end: dawn, limitDeg };
    }
  }

  return null; // polar day / extreme latitude — no dark window
}

export function jdToDate(jd: number): Date {
  // Meeus ch. 7 inverse
  const z = Math.trunc(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.trunc((z - 1867216.25) / 36524.25);
  const A = z + 1 + alpha - Math.trunc(alpha / 4);
  const B = A + 1524;
  const C = Math.trunc((B - 122.1) / 365.25);
  const D = Math.trunc(365.25 * C);
  const E = Math.trunc((B - D) / 30.6001);

  const dayWithFrac = B - D - Math.trunc(30.6001 * E) + f;
  const day = Math.trunc(dayWithFrac);
  const dayFrac = dayWithFrac - day;
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;

  const totalSeconds = dayFrac * 86400;
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.trunc((totalSeconds % 3600) / 60);
  const seconds = Math.trunc(totalSeconds % 60);

  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}
