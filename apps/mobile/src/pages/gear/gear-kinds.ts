import { t } from '@myastrosky/core/i18n/index';
import {
  accessoryLabel,
  cameraLabel,
  filterDetail,
  filterLabel,
  getAccessories,
  getCameras,
  getFilters,
  getTelescopes,
  telescopeLabel,
  type CustomGearType,
  type TelescopeData,
} from '@myastrosky/core/gear-catalog';
import { sortCustomFirst } from '@myastrosky/core/gear-sort';
import { fRatio } from '@myastrosky/core/gear-custom-fields';

// The four kinds of gear of the boards "Équipement, gérer les …" and "Équipement, ajouter …": their texts, and their
// items as the list shows them (the user's own first, as the desktop's manage window).

export const GEAR_KINDS: CustomGearType[] = ['telescope', 'camera', 'accessory', 'filter'];

export function isGearKind(value: unknown): value is CustomGearType {
  return GEAR_KINDS.includes(value as CustomGearType);
}

export const KIND_TEXTS: Record<
  CustomGearType,
  {
    manageTitle: string;
    manage: string;
    count: string;
    add: string;
    search: string;
    searchLabel: string;
  }
> = {
  telescope: {
    manageTitle: 'targets.gear.manageTelescopeTitle',
    manage: 'targets.gear.manageTelescope',
    count: 'targets.gear.telescopesSelected',
    add: 'mobile.gear.addTelescope',
    search: 'mobile.gear.searchTelescope',
    searchLabel: 'mobile.gear.searchTelescopeLabel',
  },
  camera: {
    manageTitle: 'targets.gear.manageCameraTitle',
    manage: 'targets.gear.manageCamera',
    count: 'targets.gear.camerasSelected',
    add: 'mobile.gear.addCamera',
    search: 'mobile.gear.searchCamera',
    searchLabel: 'mobile.gear.searchCameraLabel',
  },
  accessory: {
    manageTitle: 'targets.gear.manageAccessoryTitle',
    manage: 'targets.gear.manageAccessory',
    count: 'targets.gear.accessoriesSelected',
    add: 'mobile.gear.addAccessory',
    search: 'mobile.gear.searchAccessory',
    searchLabel: 'mobile.gear.searchAccessoryLabel',
  },
  filter: {
    manageTitle: 'targets.gear.manageFilterTitle',
    manage: 'targets.gear.manageFilter',
    count: 'targets.gear.filtersSelected',
    add: 'mobile.gear.addFilter',
    search: 'mobile.gear.searchFilter',
    searchLabel: 'mobile.gear.searchFilterLabel',
  },
};

/** A setup needs a telescope and a camera, so at least one of each stays ticked; accessories and filters are optional. */
export function needsOne(kind: CustomGearType): boolean {
  return kind === 'telescope' || kind === 'camera';
}

/** A telescope's line under its name: "Ouverture 72 mm · Focale 400 mm · f/5.6" (a telescope added before its ratio was
 * stored gets it from its aperture and focal length). */
export function telescopeLine(x: TelescopeData): string {
  const ratio = x.f_ratio ?? fRatio(x.aperture_mm, x.focal_length_mm);
  return [
    t('mobile.gear.aperture', { mm: x.aperture_mm }),
    t('mobile.gear.focal', { mm: x.focal_length_mm }),
    ...(ratio ? [`f/${ratio}`] : []),
  ].join(' · ');
}

export interface GearItem {
  id: string;
  title: string;
  subs: string[];
  /** A filter's colour. */
  swatch?: string;
  /** Added by the user (it can be deleted). */
  custom: boolean;
}

const isCustom = (id: string) => id.startsWith('custom-');

export async function loadGearItems(kind: CustomGearType): Promise<GearItem[]> {
  if (kind === 'telescope') {
    return sortCustomFirst(await getTelescopes()).map((x) => ({
      id: x.id,
      title: telescopeLabel(x),
      subs: [telescopeLine(x)],
      custom: isCustom(x.id),
    }));
  }
  if (kind === 'camera') {
    return sortCustomFirst(await getCameras()).map((x) => ({
      id: x.id,
      title: cameraLabel(x),
      subs: [],
      custom: isCustom(x.id),
    }));
  }
  if (kind === 'accessory') {
    return sortCustomFirst(await getAccessories()).map((x) => ({
      id: x.id,
      title: accessoryLabel(x),
      subs: [],
      custom: isCustom(x.id),
    }));
  }
  return sortCustomFirst(await getFilters()).map((x) => {
    const detail = filterDetail(x);
    return {
      id: x.id,
      title: filterLabel(x),
      subs: detail ? [detail] : [],
      swatch: x.color,
      custom: isCustom(x.id),
    };
  });
}
