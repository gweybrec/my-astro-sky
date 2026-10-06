// Sky-region (Alt/Az polygon) API shapes.

/** A freehand Alt/Az polygon drawn on the Local Sky (zenith) view, saved by name. */
export interface SkyRegionData {
  id: string;
  name: string;
  color: string;
  points: { azDeg: number; altDeg: number }[];
  position: number;
}

/** What a caller sends to create a region (the id and position are given by the service). */
export type SkyRegionInput = Omit<SkyRegionData, 'id' | 'position'>;

/** What a caller sends to change a region; a field that is absent is left alone. */
export type SkyRegionChanges = Partial<Omit<SkyRegionData, 'id'>>;
