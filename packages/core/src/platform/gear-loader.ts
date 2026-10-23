import type { CustomGearType } from '../domain/gear';

/** Loads one gear list (telescope, camera, accessory, filter). */
export type GearCatalogLoader = (type: CustomGearType) => Promise<object[]>;

let loader: GearCatalogLoader = async () => [];

/** Called once at start-up by each platform. Default: empty lists. */
export function configureGearCatalogLoader(load: GearCatalogLoader): void {
  loader = load;
}

export function loadGearList(type: CustomGearType): Promise<object[]> {
  return loader(type);
}
