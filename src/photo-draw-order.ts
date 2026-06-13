import type { Photo, Point } from './types';
import { buildPhotoQueryMatches } from './photo-search';

export interface PhotoCanvasQuad {
  id: string;
  name: string;
  corners: Point[];
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.min(a.x, b.x) <= p.x
    && p.x <= Math.max(a.x, b.x)
    && Math.min(a.y, b.y) <= p.y
    && p.y <= Math.max(a.y, b.y);
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) {
    return true;
  }

  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;

  return false;
}

export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

export function findOverlappingPhotoIds(currentPhotoId: string, quads: PhotoCanvasQuad[]): Set<string> {
  const current = quads.find((quad) => quad.id === currentPhotoId);
  const overlappingIds = new Set<string>([currentPhotoId]);
  if (!current) return overlappingIds;

  for (const quad of quads) {
    if (quad.id === currentPhotoId) continue;
    if (polygonsOverlap(current.corners, quad.corners)) {
      overlappingIds.add(quad.id);
    }
  }

  return overlappingIds;
}

export function filterDrawOrderPhotos(
  orderedPhotos: Photo[],
  query: string,
  overlapOnly: boolean,
  currentPhotoId: string,
  quads: PhotoCanvasQuad[],
): Photo[] {
  const matchIds = query.trim()
    ? new Set(buildPhotoQueryMatches(orderedPhotos, query).map((match) => match.photo.id))
    : null;
  const overlappingIds = overlapOnly ? findOverlappingPhotoIds(currentPhotoId, quads) : null;

  return orderedPhotos.filter((photo) => {
    if (matchIds && !matchIds.has(photo.id)) return false;
    if (overlappingIds && !overlappingIds.has(photo.id)) return false;
    return true;
  });
}
