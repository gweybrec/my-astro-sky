// Object-identification API shapes (asteroids, supernovae, comets).

import type { SkybotCandidate } from '../asteroid-identify';
import type { CometElements } from '../comet-ephemeris';
import type { TnsCandidate } from '../supernova-identify';

export type { SkybotCandidate, CometElements, TnsCandidate };

/** A SkyBoT cone: centre and radius, plus the epoch (Julian Date) to compute positions at. */
export interface SkybotSearchParams {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  epochJd: number;
  /** IAU observatory code; defaults to '500' (geocentre). */
  location?: string;
}

export interface TnsSearchParams {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  /** Discovery-date window, YYYY-MM-DD (inclusive). */
  dateStart: string;
  dateEnd: string;
}
