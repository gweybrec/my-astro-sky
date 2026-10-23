/**
 * The points of a star identification in progress (board "Identifier les étoiles"), kept outside its page: choosing a
 * star on the map leaves the page for the Ciel tab, and the points must be there when it comes back.
 */
import { reactive } from 'vue';
import type { SexagesimalFields } from '@myastrosky/core/star-identify';

/** A point of the photo, in the picture's own pixels. */
export interface PhotoPoint {
  x: number;
  y: number;
}

/** The star given to a point: a catalogue star (its Hipparcos number) or typed coordinates (`starHip` 0). */
export interface PointStar {
  starHip: number;
  starName: string;
  starRa?: number;
  starDec?: number;
}

export interface IdentifyPoint {
  /** Where the point is on the photo, or null while it is not placed. */
  at: PhotoPoint | null;
  /** The star it is, or null while it is not named. */
  star: PointStar | null;
  /** How it is being named: by a star's name (or on the map), or by its coordinates. */
  entry: 'star' | 'radec';
  /** The star name typed so far. */
  query: string;
  coords: SexagesimalFields;
}

/** The desktop's three points. */
export const POINT_COUNT = 3;

const emptyCoords = (): SexagesimalFields => ({
  raHours: '',
  raMinutes: '',
  raSeconds: '',
  decDegrees: '',
  decMinutes: '',
  decSeconds: '',
});

const emptyPoint = (): IdentifyPoint => ({
  at: null,
  star: null,
  entry: 'star',
  query: '',
  coords: emptyCoords(),
});

const sessions = new Map<string, IdentifyPoint[]>();

/** The points of the waiting photo's identification, new ones the first time. */
export function identifyPoints(pendingId: string): IdentifyPoint[] {
  let points = sessions.get(pendingId);
  if (!points) {
    points = reactive(Array.from({ length: POINT_COUNT }, emptyPoint));
    sessions.set(pendingId, points);
  }
  return points;
}

/** Forgets an identification: the next one of that photo starts with no point. */
export function endIdentify(pendingId: string): void {
  sessions.delete(pendingId);
}

/** The point is named again from the start (the desktop's tap on a named point). */
export function clearPointStar(point: IdentifyPoint): void {
  point.star = null;
  point.entry = 'star';
  point.query = '';
  point.coords = emptyCoords();
}
