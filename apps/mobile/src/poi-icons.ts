import asteroidSvg from '@icons/poi-asteroid.svg?raw';
import cometSvg from '@icons/poi-comet.svg?raw';
import satelliteSvg from '@icons/poi-satellite.svg?raw';
import issSvg from '@icons/poi-iss.svg?raw';
import supernovaSvg from '@icons/poi-supernova.svg?raw';

// The icons of the default kinds of points of interest, by their category id, as the desktop's `src/poi-icons.ts` (the
// same files of the icon set). A kind the user created has none and shows a coloured dot.
const ICONS: Record<string, string> = {
  'cat-asteroid': asteroidSvg,
  'cat-comet': cometSvg,
  'cat-satellite': satelliteSvg,
  'cat-iss': issSvg,
  'cat-supernova': supernovaSvg,
};

export function poiTypeIcon(categoryId: string): string | null {
  return ICONS[categoryId] ?? null;
}
