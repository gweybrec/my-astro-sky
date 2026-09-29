/**
 * Pure logic for identifying a solar-system object (asteroid) marked by the
 * user on a solved photo: converts the two marked pixels + times into a
 * SkyBoT search, then ranks the returned candidates against the markers.
 *
 * Nothing here touches the DOM or fetch — `AsteroidIdentifyModal.vue` composes
 * these functions with `src/api.ts` (which does the actual `/api/skybot/conesearch`
 * call). Kept separate so the ranking math is unit-testable in isolation
 * (see `tests/unit/asteroid-identify.test.ts`).
 */
import type { AffineMatrix, Photo, PointOfInterest } from './types';
import { applyAffine } from './affine';
import { unproject } from './projection';
import { dateToJD, jdToDate } from './astro-time';
import { t } from './i18n';

/** Converts an ISO 8601 UTC timestamp to a Julian Date. */
export function isoToJd(iso: string): number {
  return dateToJD(new Date(iso));
}

/** Converts a Julian Date to an ISO 8601 UTC timestamp. */
export function jdToIso(jd: number): string {
  return jdToDate(jd).toISOString();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Splits an ISO 8601 UTC timestamp into the literal UTC calendar date and
 * clock time — for `<input type="date">` + `<input type="time">`, read with
 * `getUTC*`, never `get*` (local). The modal's time fields are explicitly
 * labelled "(UTC)"; a native `<input type="datetime-local">` there would be
 * dishonest about that (its own values, and its browser-native "Today"/"Now"
 * shortcuts, are always in the viewer's local timezone, not UTC) — see
 * AsteroidIdentifyModal.vue. Returns `{ date: '', time: '' }` for an empty
 * or invalid input.
 */
export function isoToUtcParts(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/**
 * Inverse of {@link isoToUtcParts}: combines a `type="date"` value and a
 * `type="time"` value (each read/written as literal UTC digits) back into an
 * ISO 8601 UTC timestamp. `timeStr` defaults to midnight when empty. Returns
 * `''` when `dateStr` is empty.
 */
export function utcPartsToIso(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  const [y, m, day] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, day || 1, hh || 0, mm || 0)).toISOString();
}

/**
 * Converts a photo-pixel position to RA/Dec through the photo's photo→projection
 * affine (the same round trip `findDsoPlacementsInImage` uses in reverse).
 * Returns null when the photo has no usable solve.
 */
export function photoPixelToRaDec(
  photoToProj: AffineMatrix,
  x: number,
  y: number,
): { ra: number; dec: number } {
  const projPoint = applyAffine(photoToProj, { x, y });
  return unproject(projPoint.x, projPoint.y);
}

/**
 * Sums a photo's per-filter integration rows into a total exposure duration,
 * in seconds. Mirrors the "N × sub s" total already shown in the metadata editor.
 */
export function totalIntegrationSeconds(photo: Pick<Photo, 'integrations'>): number {
  return (photo.integrations ?? []).reduce((sum, row) => sum + row.frames * row.seconds, 0);
}

/**
 * Suggests a start/end time window for the trail markers from the photo's
 * observation date and total integration time. Returns null when the photo
 * has no observation date to anchor the window — the caller falls back to
 * empty, user-filled inputs in that case.
 *
 * The stack's actual wall-clock span is usually somewhat longer than the sum
 * of exposures (dead time between subs), so this is only a starting point —
 * both times stay editable in the modal.
 */
export function defaultTimeWindow(
  photo: Pick<Photo, 'observationDate' | 'integrations'>,
): { startIso: string; endIso: string } | null {
  if (!photo.observationDate) return null;
  const startMs = new Date(photo.observationDate).getTime();
  if (!Number.isFinite(startMs)) return null;
  const totalSeconds = totalIntegrationSeconds(photo);
  const endMs = startMs + totalSeconds * 1000;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

/** The SkyBoT search to run for a pair of marks: centred on their midpoint, at their mid-epoch. */
export interface AsteroidSearch {
  raDeg: number;
  decDeg: number;
  epochJd: number;
  /** Default cone-search radius in arcminutes; editable by the user before searching. */
  suggestedRadiusArcmin: number;
}

/**
 * Builds the SkyBoT search parameters from the two marked (RA/Dec, time) points:
 * midpoint position, mid epoch. A separation-based radius keeps the cone tight
 * for a short trail while staying wide enough to tolerate a sloppy click.
 */
export function buildSearch(
  start: { ra: number; dec: number },
  end: { ra: number; dec: number },
  startJd: number,
  endJd: number,
): AsteroidSearch {
  const decRad = (((start.dec + end.dec) / 2) * Math.PI) / 180;
  const dRa = (end.ra - start.ra) * Math.cos(decRad);
  const dDec = end.dec - start.dec;
  const trailArcmin = Math.hypot(dRa, dDec) * 60 || 0;
  return {
    raDeg: (start.ra + end.ra) / 2,
    decDeg: (start.dec + end.dec) / 2,
    epochJd: (startJd + endJd) / 2,
    suggestedRadiusArcmin: Math.min(60, Math.max(5, trailArcmin * 3 + 5)),
  };
}

/** A SkyBoT candidate as returned by the server proxy (`server/skybot.ts`). */
export interface SkybotCandidate {
  number: string | null;
  name: string;
  raDeg: number;
  decDeg: number;
  className: string;
  vMag: number | null;
  ephemErrArcsec: number | null;
  distArcsec: number | null;
  dRaArcsecPerHour: number | null;
  dDecArcsecPerHour: number | null;
}

export interface RankedCandidate extends SkybotCandidate {
  /** Mean angular separation (arcsec) between the candidate's propagated position
   *  and the marked start/end points — the primary ranking signal. */
  positionErrorArcsec: number;
  /** Difference (arcsec) between the candidate's propagated trail vector and the
   *  marked trail vector — a secondary tiebreak only; a short trail is close to
   *  click-precision noise, so this must never dominate the ranking. */
  motionErrorArcsec: number;
  /** True when SkyBoT's own orbit uncertainty for this candidate is large enough
   *  (>60″) that the match should be treated with caution regardless of rank. */
  uncertainOrbit: boolean;
}

function angularSeparationArcsec(
  raDeg1: number,
  decDeg1: number,
  raDeg2: number,
  decDeg2: number,
): number {
  const decRad = (((decDeg1 + decDeg2) / 2) * Math.PI) / 180;
  const dRa = (raDeg2 - raDeg1) * Math.cos(decRad);
  const dDec = decDeg2 - decDeg1;
  return Math.hypot(dRa, dDec) * 3600;
}

/** Linearly propagates a candidate's cataloged position by its own rate, over `hours`. */
function propagate(candidate: SkybotCandidate, hours: number): { raDeg: number; decDeg: number } {
  const decRad = (candidate.decDeg * Math.PI) / 180;
  const dRaRate = candidate.dRaArcsecPerHour ?? 0; // already cos(dec)-corrected by SkyBoT
  const dDecRate = candidate.dDecArcsecPerHour ?? 0;
  return {
    raDeg: candidate.raDeg + (dRaRate * hours) / 3600 / Math.cos(decRad),
    decDeg: candidate.decDeg + (dDecRate * hours) / 3600,
  };
}

/**
 * Ranks SkyBoT candidates by how well their (rate-propagated) position at the
 * marked start/end times reproduces the two marked endpoints. Position error
 * is the dominant signal — for a short trail (a few arcsec to tens of arcsec)
 * the motion vector alone is close to the noise floor of a mouse click.
 */
export function rankCandidates(
  candidates: SkybotCandidate[],
  marks: {
    start: { ra: number; dec: number; jd: number };
    end: { ra: number; dec: number; jd: number };
  },
  queryEpochJd: number,
): RankedCandidate[] {
  const { start, end } = marks;
  const markedDRa =
    (end.ra - start.ra) * Math.cos((((start.dec + end.dec) / 2) * Math.PI) / 180) * 3600;
  const markedDDec = (end.dec - start.dec) * 3600;

  return candidates
    .map((c) => {
      const startPos = propagate(c, (start.jd - queryEpochJd) * 24);
      const endPos = propagate(c, (end.jd - queryEpochJd) * 24);
      const startErr = angularSeparationArcsec(
        startPos.raDeg,
        startPos.decDeg,
        start.ra,
        start.dec,
      );
      const endErr = angularSeparationArcsec(endPos.raDeg, endPos.decDeg, end.ra, end.dec);
      const positionErrorArcsec = (startErr + endErr) / 2;

      const predictedDRa =
        (endPos.raDeg - startPos.raDeg) *
        Math.cos((((startPos.decDeg + endPos.decDeg) / 2) * Math.PI) / 180) *
        3600;
      const predictedDDec = (endPos.decDeg - startPos.decDeg) * 3600;
      const motionErrorArcsec = Math.hypot(predictedDRa - markedDRa, predictedDDec - markedDDec);

      return {
        ...c,
        positionErrorArcsec,
        motionErrorArcsec,
        uncertainOrbit: (c.ephemErrArcsec ?? 0) > 60,
      };
    })
    .sort(
      (a, b) =>
        a.positionErrorArcsec - b.positionErrorArcsec || a.motionErrorArcsec - b.motionErrorArcsec,
    );
}

/** Formats a SkyBoT candidate into the POI name used when adding it to a photo. */
export function formatCandidateName(c: Pick<SkybotCandidate, 'number' | 'name'>): string {
  return c.number ? `(${c.number}) ${c.name}` : c.name;
}

/**
 * Builds the PointOfInterest to append to a photo for a chosen candidate, with the
 * candidate's position at the search epoch (mid-trail) so it can be pinned on the
 * photo and the sky map like identified comets and supernovae.
 */
export function candidateToPoi(
  c: Pick<SkybotCandidate, 'number' | 'name' | 'raDeg' | 'decDeg'>,
  categoryId: string,
): PointOfInterest {
  const ra = ((c.raDeg % 360) + 360) % 360;
  return { name: formatCandidateName(c), categoryId, ra, dec: c.decDeg };
}

// SkyBoT's dynamical classification arrives as a raw code — "MB>Middle",
// "Mars-Crosser" — never meant for display. Prefixes (before ">") get a
// translated family name; the subtype after ">" (Inner/Middle/Outer, Amor,
// Apollo…) is a technical dynamical-family term left as-is across languages,
// the same way "quasar" or a genus name isn't translated.
const CLASS_PREFIX_KEYS: Record<string, string> = {
  MB: 'asteroid.classMainBelt',
  NEA: 'asteroid.classNea',
  TNO: 'asteroid.classTno',
};
const CLASS_EXACT_KEYS: Record<string, string> = {
  'Mars-Crosser': 'asteroid.classMarsCrosser',
  Centaur: 'asteroid.classCentaur',
  Trojan: 'asteroid.classTrojan',
};

/**
 * Turns a raw SkyBoT `Class` code into a readable, translated label.
 * Never surfaces the raw code verbatim: an unrecognised code (SkyBoT's
 * taxonomy isn't fully enumerated here) still gets its punctuation stripped
 * into plain words rather than showing "MB>Something" unexplained.
 */
export function formatAsteroidClass(rawClass: string): string {
  if (!rawClass) return '';
  const exactKey = CLASS_EXACT_KEYS[rawClass];
  if (exactKey) return t(exactKey);
  const [prefix, subtype] = rawClass.split('>');
  const prefixKey = CLASS_PREFIX_KEYS[prefix];
  if (prefixKey) {
    const label = t(prefixKey);
    return subtype ? `${label} (${subtype})` : label;
  }
  return rawClass.replace(/[>-]/g, ' ');
}
