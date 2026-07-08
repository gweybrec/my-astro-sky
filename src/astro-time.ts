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
  return (gmstHours(jd) + lonDeg / 15 + 24) % 24;
}

// ─── Sun position ──────────────────────────────────────────────────────────

function sunEclipticLongDeg(jd: number): number {
  // Low-precision sun longitude, Meeus ch. 25 simplified
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
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

// ─── Moon position & phase ──────────────────────────────────────────────────

/**
 * Moon's fundamental arguments (Meeus ch. 47), all in degrees.
 * Shared by the position and phase calculations.
 */
function moonArgs(jd: number) {
  const T = (jd - 2451545.0) / 36525.0;
  const norm = (x: number) => ((x % 360) + 360) % 360;
  return {
    T,
    Lp: norm(
      218.3164477 +
        481267.88123421 * T -
        0.0015786 * T * T +
        (T * T * T) / 538841 -
        (T * T * T * T) / 65194000,
    ), // mean longitude
    D: norm(
      297.8501921 +
        445267.1114034 * T -
        0.0018819 * T * T +
        (T * T * T) / 545868 -
        (T * T * T * T) / 113065000,
    ), // mean elongation
    M: norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T * T * T) / 24490000), // sun mean anomaly
    Mp: norm(
      134.9633964 +
        477198.8675055 * T +
        0.0087414 * T * T +
        (T * T * T) / 69699 -
        (T * T * T * T) / 14712000,
    ), // moon mean anomaly
    F: norm(
      93.272095 +
        483202.0175233 * T -
        0.0036539 * T * T -
        (T * T * T) / 3526000 +
        (T * T * T * T) / 863310000,
    ), // argument of latitude
  };
}

/**
 * Geocentric apparent Moon RA/Dec in degrees for a given JD.
 * Low-precision reduced ELP (Meeus ch. 47, main periodic terms only):
 * accurate to roughly ±0.3° — ample for an altitude curve and a coarse
 * moon-to-target separation. Topocentric parallax (~1°) is intentionally
 * omitted (it would not change the visual conclusions).
 */
export function moonRaDecDeg(jd: number): { raDeg: number; decDeg: number } {
  const { T, Lp, D, M, Mp, F } = moonArgs(jd);
  const d = D * DEG,
    m = M * DEG,
    mp = Mp * DEG,
    f = F * DEG;
  // Eccentricity correction for terms involving the Sun's anomaly M.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  // Longitude terms Σl (coefficients in 1e-6 deg), args [D, M, M', F].
  const lonTerms: [number, number, number, number, number][] = [
    [6288774, 0, 0, 1, 0],
    [1274027, 2, 0, -1, 0],
    [658314, 2, 0, 0, 0],
    [213618, 0, 0, 2, 0],
    [-185116, 0, 1, 0, 0],
    [-114332, 0, 0, 0, 2],
    [58793, 2, 0, -2, 0],
    [57066, 2, -1, -1, 0],
    [53322, 2, 0, 1, 0],
    [45758, 2, -1, 0, 0],
    [-40923, 0, 1, -1, 0],
    [-34720, 1, 0, 0, 0],
    [-30383, 0, 1, 1, 0],
    [15327, 2, 0, 0, -2],
    [-12528, 0, 0, 1, 2],
    [10980, 0, 0, 1, -2],
  ];
  // Latitude terms Σb.
  const latTerms: [number, number, number, number, number][] = [
    [5128122, 0, 0, 0, 1],
    [280602, 0, 0, 1, 1],
    [277693, 0, 0, 1, -1],
    [173237, 2, 0, 0, -1],
    [55413, 2, 0, -1, 1],
    [46271, 2, 0, -1, -1],
    [32573, 2, 0, 0, 1],
    [17198, 0, 0, 2, 1],
    [9266, 2, 0, 1, -1],
    [8822, 0, 0, 2, -1],
    [8216, 2, -1, 0, -1],
    [4324, 2, 0, -2, -1],
  ];

  let sumL = 0,
    sumB = 0;
  for (const [c, cd, cm, cmp, cf] of lonTerms) {
    const e = cm === 0 ? 1 : Math.abs(cm) === 1 ? E : E * E;
    sumL += c * e * Math.sin(cd * d + cm * m + cmp * mp + cf * f);
  }
  for (const [c, cd, cm, cmp, cf] of latTerms) {
    const e = cm === 0 ? 1 : Math.abs(cm) === 1 ? E : E * E;
    sumB += c * e * Math.sin(cd * d + cm * m + cmp * mp + cf * f);
  }

  const lambda = (Lp + sumL / 1e6) * DEG; // ecliptic longitude
  const beta = (sumB / 1e6) * DEG; // ecliptic latitude
  const eps = (23.439291 - 0.0130042 * T) * DEG; // mean obliquity

  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lambda),
  );
  const dec = Math.asin(
    Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda),
  );
  return { raDeg: (((ra / DEG) % 360) + 360) % 360, decDeg: dec / DEG };
}

/**
 * Moon phase for a given JD (Meeus ch. 48, simplified):
 * - `illum`: illuminated fraction of the disk (0 = new, 1 = full)
 * - `waxing`: true while the Moon is growing (east of the Sun, elongation 0–180°)
 * - `phaseIndex`: 0–7 selecting one of the 8 standard phase icons
 *   (0 new · 1 waxing crescent · 2 first quarter · 3 waxing gibbous ·
 *    4 full · 5 waning gibbous · 6 last quarter · 7 waning crescent)
 */
export function moonPhase(jd: number): { illum: number; waxing: boolean; phaseIndex: number } {
  const { D, M, Mp } = moonArgs(jd);
  const d = D * DEG,
    m = M * DEG,
    mp = Mp * DEG;
  // Phase angle i (Sun–Moon–Earth), Meeus eq. 48.4.
  const i =
    180 -
    D -
    6.289 * Math.sin(mp) +
    2.1 * Math.sin(m) -
    1.274 * Math.sin(2 * d - mp) -
    0.658 * Math.sin(2 * d) -
    0.214 * Math.sin(2 * mp) -
    0.11 * Math.sin(d);
  const illum = (1 + Math.cos(i * DEG)) / 2;
  const waxing = D % 360 < 180; // elongation 0–180° → Moon east of Sun → waxing

  let phaseIndex: number;
  if (illum < 0.04) phaseIndex = 0;
  else if (illum > 0.96) phaseIndex = 4;
  else if (waxing) phaseIndex = illum < 0.46 ? 1 : illum < 0.54 ? 2 : 3;
  else phaseIndex = illum < 0.46 ? 7 : illum < 0.54 ? 6 : 5;

  return { illum, waxing, phaseIndex };
}

// ─── Twilight window ────────────────────────────────────────────────────────

/**
 * Returns the astronomical twilight window (sun < −18°) for the night
 * starting at `localNoon` (the noon before the observing night).
 * Falls back to nautical (−12°) then civil (−6°) at high latitudes.
 * If the sun never sets (polar day), returns null.
 */
export interface TwilightWindow {
  start: Date; // astronomical dusk (or best available)
  end: Date; // astronomical dawn (or best available)
  limitDeg: number; // actual sun elevation used (−18, −12, or −6)
}

export function twilightWindow(
  date: Date, // any moment on the night's date (local)
  latDeg: number,
  lonDeg: number,
  // Sun-elevation thresholds to try, widest-night-first: the first that yields a valid
  // dusk/dawn wins. Default = astronomical → nautical → civil (for imaging). Pass e.g.
  // [-6, 0] for a wider "visual" window (bright double stars are fine in twilight).
  limits: number[] = [-18, -12, -6],
): TwilightWindow | null {
  // We sample the night bracketing local midnight (UTC).
  // Build a JD at noon UTC of the given date as starting point.
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  const jdNoon = dateToJD(noon);

  for (const limitDeg of limits) {
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
