// Sky-region (Alt/Az polygon) API shapes.

/** A freehand Alt/Az polygon drawn on the Local Sky (zenith) view, saved by name. */
export interface SkyRegionData {
  id: string;
  name: string;
  color: string;
  points: { azDeg: number; altDeg: number }[];
  position: number;
}
