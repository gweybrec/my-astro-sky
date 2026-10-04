// Gear-setup API shapes.

export interface GearSetupData {
  id: string;
  name: string;
  telescopeId: string;
  cameraId: string;
  accessoryId: string | null;
  enabled: boolean;
}

/** Equipment categories stored as custom gear. Filters are picked per integration row, not per setup. */
export type CustomGearType = 'telescope' | 'camera' | 'accessory' | 'filter';

/** The built-in equipment lists, as loaded by the shell (a file on the server, a bundled asset on the phone). */
export interface GearCatalog {
  telescopes: readonly object[];
  cameras: readonly object[];
  accessories: readonly object[];
  filters: readonly object[];
}
