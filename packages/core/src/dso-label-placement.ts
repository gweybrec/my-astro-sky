/**
 * Where to put a DSO label on a photo overlay so it does not land on one already
 * placed. Ported from the sibling Android app's `ui/LabelPlacement.kt`
 * (`C:\Workspace\TiffViewer`) — same algorithm, same candidate order, same fallback.
 *
 * Outlines cannot move — each is a claim about a patch of the photo — but a name is
 * only attached to its object by proximity, so it may be nudged. In a crowded field
 * (two DSOs close together, e.g. M97/M108 in the same frame) leaving names where they
 * fall makes them illegible exactly when there is most to read.
 *
 * Greedy and deterministic. Callers place labels in the order they care about them —
 * brightest/largest first — so the most important name gets its preferred spot and
 * later ones move around it.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Radius to clear on each axis — an ellipse's horizontal (`x`) and vertical (`y`)
 * half-extents, so a wide, short ellipse doesn't push its label down by its (much
 * larger) horizontal radius, and a tall, narrow one doesn't push it sideways by its
 * horizontal radius either. A circle just passes the same value for both. */
export interface Clearance {
  x: number;
  y: number;
}

function rectAt(left: number, top: number, size: Size): Rect {
  return { left, top, right: left + size.width, bottom: top + size.height };
}

export function rectCenterX(r: Rect): number {
  return (r.left + r.right) / 2;
}

function inflate(r: Rect, amount: number): Rect {
  return {
    left: r.left - amount,
    top: r.top - amount,
    right: r.right + amount,
    bottom: r.bottom + amount,
  };
}

function translate(r: Rect, dx: number, dy: number): Rect {
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** How far a label may be pushed down before it is left where it lands. Enough that a
 * whole cluster can stack into a column even in the degenerate case where every object
 * projects onto the same point — eight candidate positions plus these. */
const MAX_STEPS = 16;

function belowRect(anchor: Point, clearance: Clearance, size: Size, gap: number): Rect {
  return rectAt(anchor.x - size.width / 2, anchor.y + clearance.y + gap, size);
}

/**
 * Positions to try, in order of preference. Below first, because a name under a thing
 * reads as belonging to it; then above; then to the sides, which stay level with the
 * object and so remain unambiguous even when several names end up in a row.
 *
 * Below/above offset by `clearance.y`, left/right by `clearance.x` — so a wide,
 * short ellipse's label sits close under it instead of pushed down by its long axis.
 */
function candidates(anchor: Point, clearance: Clearance, size: Size, gap: number): Rect[] {
  const outX = clearance.x + gap;
  const outY = clearance.y + gap;
  const halfHeight = size.height / 2;
  return [
    belowRect(anchor, clearance, size, gap),
    rectAt(anchor.x - size.width / 2, anchor.y - outY - size.height, size),
    rectAt(anchor.x + outX, anchor.y - halfHeight, size),
    rectAt(anchor.x - outX - size.width, anchor.y - halfHeight, size),
    rectAt(anchor.x + outX, anchor.y + outY, size),
    rectAt(anchor.x - outX - size.width, anchor.y + outY, size),
    rectAt(anchor.x + outX, anchor.y - outY - size.height, size),
    rectAt(anchor.x - outX - size.width, anchor.y - outY - size.height, size),
  ];
}

/**
 * Place a label anchored at `anchor`, avoiding every rect in `occupied`.
 *
 * @param anchor Centre of the object being named, in overlay coordinates.
 * @param clearance Radius to clear on each axis: the object's own outline/marker.
 * @param size Measured size of the label text.
 * @param gap Breathing room between the text and both the outline and its neighbours.
 * @param occupied Rects already claimed by earlier labels (and any fixed obstacle).
 */
export function placeLabel(
  anchor: Point,
  clearance: Clearance,
  size: Size,
  gap: number,
  occupied: Rect[],
): Rect {
  for (const candidate of candidates(anchor, clearance, size, gap)) {
    if (!occupied.some((r) => overlaps(r, inflate(candidate, gap)))) return candidate;
  }
  // Everything nearby is taken. Walk downwards until something is free, so a tight
  // cluster stacks into a readable column rather than a single unreadable blot.
  const step = size.height + gap;
  let below = belowRect(anchor, clearance, size, gap);
  for (let i = 0; i < MAX_STEPS; i++) {
    below = translate(below, 0, step);
    if (!occupied.some((r) => overlaps(r, inflate(below, gap)))) return below;
  }
  return below;
}
