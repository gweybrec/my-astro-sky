import asteroidSvg from './icons/poi-asteroid.svg?raw';
import cometSvg from './icons/poi-comet.svg?raw';
import satelliteSvg from './icons/poi-satellite.svg?raw';
import issSvg from './icons/poi-iss.svg?raw';
import supernovaSvg from './icons/poi-supernova.svg?raw';

/**
 * Raw inline SVGs for the seeded default POI types, keyed by their stable category
 * id (see the seed in server/db.ts). User-created types have no icon and fall back
 * to the coloured dot. Icons use `fill: currentColor`, so they take the type colour
 * when rendered inside `.poi-marker` (which sets `color: var(--poi-color)`).
 */
const DEFAULT_POI_TYPE_ICONS: Record<string, string> = {
  'cat-asteroid': asteroidSvg,
  'cat-comet': cometSvg,
  'cat-satellite': satelliteSvg,
  'cat-iss': issSvg,
  'cat-supernova': supernovaSvg,
};

/** The icon SVG for a default POI type, or null for custom types (use the dot). */
export function poiTypeIcon(categoryId: string): string | null {
  return DEFAULT_POI_TYPE_ICONS[categoryId] ?? null;
}
