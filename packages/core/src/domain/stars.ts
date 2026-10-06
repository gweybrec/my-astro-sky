// Star-search API shapes.

import type { StarMultiplicity } from '../types';

export interface StarSearchResult {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  multiplicity?: StarMultiplicity;
  label: string;
  score: number;
}

/** A star of the deep catalogue (Hipparcos id, J2000 position in degrees, optional names). */
export interface DeepStar {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  multiplicity?: StarMultiplicity;
}

/** Parameters of a search around a position (degrees). */
export interface NearbyStarsQuery {
  ra: number;
  dec: number;
  /** Search radius in degrees. */
  radius: number;
  /** Only stars at least this bright are returned. Default 10. */
  magLimit?: number;
  /** Maximum number of results, between 1 and 100. Default 20. */
  limit?: number;
}
