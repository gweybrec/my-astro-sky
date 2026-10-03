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
