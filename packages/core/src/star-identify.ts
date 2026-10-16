/**
 * The parts of the "identify stars" step (the desktop's `openManualIdentifyModal`, the phone's "Identifier les
 * étoiles") that do not depend on a screen: how a star is named once chosen, and how a point typed as RA/Dec becomes
 * degrees.
 */
import type { Star } from './types';

/** A chosen star's name in the list of points: "Deneb (α Cyg)", else its designation, else its Hipparcos number. */
export function starDisplayLabel(star: Star): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.desig && star.constellation) {
    return `${star.desig} ${star.constellation}`;
  }
  if (star.flam && star.constellation) {
    return `${star.flam} ${star.constellation}`;
  }
  return `HIP ${star.hip} (${star.constellation || '?'}, mag ${star.mag.toFixed(1)})`;
}

/** The six fields of a point typed as coordinates, as the user typed them. */
export interface SexagesimalFields {
  raHours: string;
  raMinutes: string;
  raSeconds: string;
  decDegrees: string;
  decMinutes: string;
  decSeconds: string;
}

/**
 * A point typed as right ascension (h m s) and declination (° ' "), in degrees; null when a field is empty, not a number
 * or out of its range (hours 0-23, minutes and seconds 0-59, degrees ±89). The declination's sign is the one typed
 * before the degrees, so "-0° 30'" is south of the equator.
 */
export function raDecFromSexagesimal(
  fields: SexagesimalFields,
): { ra: number; dec: number } | null {
  const h = parseFloat(fields.raHours);
  const m = parseFloat(fields.raMinutes);
  const s = parseFloat(fields.raSeconds);
  const d = parseFloat(fields.decDegrees);
  const dm = parseFloat(fields.decMinutes);
  const ds = parseFloat(fields.decSeconds);
  if ([h, m, s, d, dm, ds].some((n) => isNaN(n))) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  if (d < -89 || d > 89 || dm < 0 || dm > 59 || ds < 0 || ds > 59) return null;
  const ra = (h + m / 60 + s / 3600) * 15;
  const south = fields.decDegrees.trim().startsWith('-');
  const dec = (south ? -1 : 1) * (Math.abs(d) + dm / 60 + ds / 3600);
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
  return { ra, dec };
}
