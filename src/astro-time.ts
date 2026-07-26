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
 * Geocentric apparent Sun RA/Dec in degrees for a given JD.
 * Low-precision (Meeus ch. 25 simplified) — same accuracy class as sunEclipticLongDeg.
 */
export function sunRaDecDeg(jd: number): { raDeg: number; decDeg: number } {
  const lambda = sunEclipticLongDeg(jd) * DEG;
  const epsilon = 23.439 * DEG; // mean obliquity (approx)

  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  return { raDeg: (((ra / DEG) % 360) + 360) % 360, decDeg: dec / DEG };
}

/**
 * Sun altitude in degrees above horizon for a given JD, lat, lon.
 */
export function sunAltDeg(jd: number, latDeg: number, lonDeg: number): number {
  const { raDeg, decDeg } = sunRaDecDeg(jd);
  const dec = decDeg * DEG;

  // Hour angle
  const lst = lstHours(jd, lonDeg);
  const ha = ((lst - raDeg / 15 + 24) % 24) * 15 * DEG; // radians

  const lat = latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
}

// ─── Planet positions ───────────────────────────────────────────────────────

export type PlanetKey = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

export const PLANET_KEYS: PlanetKey[] = [
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
];

/**
 * J2000.0 mean Keplerian orbital elements and their per-Julian-century rates
 * (JPL "Keplerian elements for approximate positions of the major planets",
 * valid 1800-2050). Units: a in AU, angles in degrees.
 * [a, aDot, e, eDot, i, iDot, L, LDot, peri, periDot, node, nodeDot]
 */
type ElementRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const EARTH_ELEMENTS: ElementRow = [
  1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166,
  35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0,
];

const PLANET_ELEMENTS: Record<PlanetKey, ElementRow> = {
  mercury: [
    0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235,
    149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081,
  ],
  venus: [
    0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995,
    58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418,
  ],
  mars: [
    1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205,
    19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343,
  ],
  jupiter: [
    5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051,
    3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106,
  ],
  saturn: [
    9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423,
    1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794,
  ],
  uranus: [
    19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451,
    428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589,
  ],
  neptune: [
    30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969,
    218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664,
  ],
};

/** Heliocentric ecliptic rectangular coordinates (AU, J2000 ecliptic frame) at time T (centuries since J2000). */
function heliocentricEclipticXYZ(row: ElementRow, T: number): [number, number, number] {
  const [a0, aDot, e0, eDot, i0, iDot, L0, LDot, peri0, periDot, node0, nodeDot] = row;
  const a = a0 + aDot * T;
  const e = e0 + eDot * T;
  const iDeg = i0 + iDot * T;
  const LDeg = L0 + LDot * T;
  const periDeg = peri0 + periDot * T; // longitude of perihelion (ϖ)
  const nodeDeg = node0 + nodeDot * T; // longitude of ascending node (Ω)

  const wDeg = periDeg - nodeDeg; // argument of perihelion
  let MDeg = LDeg - periDeg; // mean anomaly
  MDeg = ((MDeg + 180) % 360) - 180; // normalize to [-180, 180) for fast Kepler convergence
  if (MDeg < -180) MDeg += 360;

  // Solve Kepler's equation E - e*sin(E) = M (degrees, Meeus/JPL iteration form).
  const eStarDeg = (e * 180) / Math.PI;
  let E = MDeg + eStarDeg * Math.sin(MDeg * DEG);
  for (let iter = 0; iter < 10; iter++) {
    const dM = MDeg - (E - eStarDeg * Math.sin(E * DEG));
    const dE = dM / (1 - e * Math.cos(E * DEG));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const Erad = E * DEG;

  // Heliocentric coordinates in the orbital plane.
  const xp = a * (Math.cos(Erad) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Erad);

  const w = wDeg * DEG;
  const node = nodeDeg * DEG;
  const i = iDeg * DEG;

  const cosW = Math.cos(w),
    sinW = Math.sin(w);
  const cosNode = Math.cos(node),
    sinNode = Math.sin(node);
  const cosI = Math.cos(i),
    sinI = Math.sin(i);

  const xecl =
    (cosW * cosNode - sinW * sinNode * cosI) * xp + (-sinW * cosNode - cosW * sinNode * cosI) * yp;
  const yecl =
    (cosW * sinNode + sinW * cosNode * cosI) * xp + (-sinW * sinNode + cosW * cosNode * cosI) * yp;
  const zecl = sinW * sinI * xp + cosW * sinI * yp;

  return [xecl, yecl, zecl];
}

/**
 * Geocentric apparent RA/Dec in degrees for a given planet and JD.
 * Low-precision Keplerian-element method (JPL "approximate positions of the
 * major planets", valid 1800-2050) — same accuracy class as the Moon/Sun
 * formulas above (light-minutes-scale accuracy, no light-time correction).
 */
export function planetRaDecDeg(jd: number, planet: PlanetKey): { raDeg: number; decDeg: number } {
  const T = (jd - 2451545.0) / 36525.0;
  const [xp, yp, zp] = heliocentricEclipticXYZ(PLANET_ELEMENTS[planet], T);
  const [xe, ye, ze] = heliocentricEclipticXYZ(EARTH_ELEMENTS, T);

  // Geocentric ecliptic vector.
  const xg = xp - xe;
  const yg = yp - ye;
  const zg = zp - ze;

  const eps = 23.43928 * DEG; // mean obliquity at J2000
  const xeq = xg;
  const yeq = yg * Math.cos(eps) - zg * Math.sin(eps);
  const zeq = yg * Math.sin(eps) + zg * Math.cos(eps);

  const ra = Math.atan2(yeq, xeq);
  const dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq));
  return { raDeg: (((ra / DEG) % 360) + 360) % 360, decDeg: dec / DEG };
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
