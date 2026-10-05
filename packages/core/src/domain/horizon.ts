/** What the horizon service is asked for. */
export interface HorizonQuery {
  /** Observer latitude, -90 to 90. */
  lat: number;
  /** Observer longitude. */
  lon: number;
  /** Search radius for terrain in km, clamped to 1..100; 40 when absent. */
  radiusKm?: number;
  /** Eye height above local ground in metres; null or absent means the default of 1.7 m. */
  obsHeightM?: number | null;
}
