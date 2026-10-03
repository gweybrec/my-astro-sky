// Night-plan API shapes (plans, entries, mosaics, observation windows).

/**
 * A user-drawn observation window on a plan entry's night trajectory: a time
 * region (two draggable edges) during which the target will be imaged, with an
 * optional imaging filter and colour. Positions are stored as fractions of the
 * plotted night window so they render identically on the interactive chart and
 * the exported PDF (both map the same `win` via the chart's `xAt`).
 */
export interface ObservationWindow {
  id: string;
  /** Start position within the night window, [0,1] (win.start → win.end). */
  startFrac: number;
  /** End position within the night window, [0,1]; always > startFrac. */
  endFrac: number;
  /** Imaging filter name (e.g. 'Ha'), or null for no filter. */
  filter: string | null;
  /** Explicit CSS colour when the user overrides; null ⇒ derive from the filter. */
  color: string | null;
  /** Single-frame (sub) exposure in seconds; null ⇒ unset. Also the optional
   * drag snap-step when the window's step mode is enabled. */
  frameSeconds: number | null;
  /** When true, dragging snaps to whole single-frame steps (the "link" toggle).
   * Defaults on for newly created windows. */
  snap: boolean;
}

export interface PlanEntry {
  id: string;
  /** Target DSO id, or null for a custom location (framed on empty sky). */
  dsoId: string | null;
  position: number;
  paDeg: number | null;
  /** Frame-centre sky coordinates (degrees); null → use the DSO position. */
  ra: number | null;
  dec: number | null;
  notes: string | null;
  /** Mosaic this entry is a tile of, or null for a standalone frame. */
  mosaicId: string | null;
  /** Smart-scope single-frame mosaic size (deg); null ⇒ render at native FOV. */
  mosaicWDeg: number | null;
  mosaicHDeg: number | null;
  /** User-drawn observation windows on the night trajectory (may be empty). */
  observationWindows: ObservationWindow[];
}

/** A mosaic: a group of tile entries covering one target. Tiles are the plan
 * entries whose `mosaicId` equals this id; this record holds the group params. */
export interface PlanMosaic {
  id: string;
  dsoId: string | null;
  /** User-supplied name; null on legacy mosaics (then derived from the DSO). */
  name: string | null;
  /** Mosaic centre (degrees). */
  centerRa: number;
  centerDec: number;
  /** Group position angle (°E of N). */
  paDeg: number;
  /** Overlap percentage between adjacent tiles. */
  overlapPct: number;
  cols: number;
  rows: number;
  position: number;
}

/** Per-tile sky centre sent to the server when creating/updating a mosaic. */
export interface MosaicTileInput {
  ra: number;
  dec: number;
  paDeg: number | null;
}

export interface MosaicParams {
  dsoId: string | null;
  /** Omit to leave a stored name unchanged (background drags/transforms). */
  name?: string;
  centerRa: number;
  centerDec: number;
  paDeg: number;
  overlapPct: number;
  cols: number;
  rows: number;
  tiles: MosaicTileInput[];
  /** Standalone plan entries this mosaic replaces — deleted when it is created. */
  replaceEntryIds?: string[];
}

/**
 * Sort key for a plan's objects list (and its exported PDF). Mirrors the
 * meaningful subset of the Targets-search sort values plus `window` (order by
 * each entry's earliest observation window). `transit` is the default.
 */
export type PlanSortKey =
  'transit' | 'altitude' | 'rating' | 'magnitude' | 'size' | 'name' | 'difficulty' | 'window';

export interface Plan {
  id: string;
  name: string;
  position: number;
  /** Observation night (ISO `YYYY-MM-DD`), or null to fall back to the global date. */
  nightOf: string | null;
  /** Gear setup id used for this plan's FOV/recipe, or null. */
  setupId: string | null;
  /** Observing latitude (°N), or null to fall back to the global location. */
  lat: number | null;
  /** Observing longitude (°E), or null to fall back to the global location. */
  lon: number | null;
  /** Objects-list sort key (drives the UI list and the exported PDF order). */
  sortBy: PlanSortKey;
  entries: PlanEntry[];
  mosaics: PlanMosaic[];
}
