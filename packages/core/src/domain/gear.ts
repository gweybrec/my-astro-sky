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

/**
 * The fields of a custom gear item a caller sends. The service requires a non-null object and stores it
 * as given (it adds the `id`); which fields each type carries is the editor's business.
 */
export type CustomGearInput = Record<string, unknown>;

/** A setup a caller sends: the same fields as a stored one, without its id. */
export type GearSetupInput = Omit<GearSetupData, 'id'>;

/**
 * The name a custom gear item goes by in a backup preview and in the "already exists" match: "brand model"
 * (the label the app shows for telescopes, cameras and accessories), else its `name`, else its id. A custom
 * filter has no brand worth showing, so it goes by its `name`, then its `model`.
 */
export function customGearName(type: string, data: Record<string, unknown>, id: string): string {
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  if (type !== 'filter') {
    const label = [text(data.brand), text(data.model)].filter(Boolean).join(' ');
    if (label) return label;
  }
  return text(data.name) || (type === 'filter' ? text(data.model) : '') || id;
}

/** The built-in equipment lists, as loaded by the shell (a file on the server, a bundled asset on the phone). */
export interface GearCatalog {
  telescopes: readonly object[];
  cameras: readonly object[];
  accessories: readonly object[];
  filters: readonly object[];
}
