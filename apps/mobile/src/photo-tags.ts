import type { PoiCategory, PointOfInterest } from '@myastrosky/core/types';
import { resolveCategory } from '@myastrosky/core/poi';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import { poiTypeIcon } from './poi-icons';

/** A chip of a photo: its equipment, a point of interest, a label or an object. */
export interface PhotoTag {
  kind: 'setup' | 'poi' | 'label' | 'dso';
  text: string;
  /** A point of interest's colour, and the icon of its kind when it has one (a coloured dot otherwise). */
  color?: string;
  icon?: string | null;
}

/**
 * A photo's chips in the order of the desktop's gallery card: its equipment, its points of interest, its labels, its
 * objects (the most important catalogue first). The search lists only the ones that matched, in the same order.
 */
export function photoTags(
  parts: {
    setupName?: string;
    pois?: readonly PointOfInterest[];
    labels?: readonly string[];
    dsoIds?: readonly string[];
  },
  categories: PoiCategory[],
): PhotoTag[] {
  const tags: PhotoTag[] = [];
  if (parts.setupName) tags.push({ kind: 'setup', text: parts.setupName });
  for (const poi of parts.pois ?? []) {
    tags.push({
      kind: 'poi',
      text: poi.name,
      color: resolveCategory(poi.categoryId, categories).color,
      icon: poiTypeIcon(poi.categoryId),
    });
  }
  for (const label of parts.labels ?? []) tags.push({ kind: 'label', text: label });
  for (const id of sortDsoIdsByImportance(parts.dsoIds ?? [])) tags.push({ kind: 'dso', text: id });
  return tags;
}
