import type { DSO, DSOType, DSOUserOverride, PhotoCorrespondence } from './types';
import type { AffineMatrix } from './types';
import { getLang } from './i18n';
import { project, invalidateProjections } from './projection';
import { computeAffineTransform } from './affine';
import { getDsoOverrides } from './api';

let dsos: DSO[] = [];
const dsoById = new Map<string, DSO>();

// Global importance rank (id → 0-based rank, most important first), built lazily from
// `dsos` and cached. Invalidated when a rating override changes (see
// invalidateDSOImportanceRank). Drives the area-weighted DSO density gate so on-screen
// density tracks the true sky (Milky Way denser) instead of the blue-noise `priority`,
// which evens that natural clustering out. See getDSOImportanceRank.
let dsoImportanceRank: Map<string, number> | null = null;

// ─── User override support ────────────────────────────────────────────────────

export interface DSOBaseValues {
  ra: number;
  dec: number;
  nameFr: string | null;
  nameEn: string | null;
  nameEs: string | null;
  nameDe: string | null;
  constellation: string | null;
  rating: number | null;
  difficulty: number | null;
  type: DSOType;
}

const baseValues = new Map<string, DSOBaseValues>();
const userOverrides = new Map<string, DSOUserOverride>();

function computeDisplayName(
  nameFr: string | null,
  nameEn: string | null,
  nameEs: string | null,
  nameDe: string | null,
  lang: string,
): string | null {
  if (lang === 'fr') return nameFr;
  if (lang === 'es') return nameEs || nameEn || nameFr;
  if (lang === 'de') return nameDe || nameEn || nameFr;
  return nameEn || nameFr;
}

export function applyUserOverrideToDso(dso: DSO, override: DSOUserOverride, lang: string): void {
  const base = baseValues.get(dso.id);
  if (!base) return;
  const effectiveFr = override.names?.fr ?? base.nameFr;
  const effectiveEn = override.names?.en ?? base.nameEn;
  const effectiveEs = override.names?.es ?? base.nameEs;
  const effectiveDe = override.names?.de ?? base.nameDe;
  dso.displayName = computeDisplayName(effectiveFr, effectiveEn, effectiveEs, effectiveDe, lang);
  const newRa = override.ra ?? dso.ra;
  const newDec = override.dec ?? dso.dec;
  if (newRa !== dso.ra || newDec !== dso.dec) {
    dso.ra = newRa;
    dso.dec = newDec;
    // Position changed: drop the cached projection so projectCached / spatial indexes
    // recompute instead of serving the object's old place on the map.
    invalidateProjections();
  }
  if (override.constellation !== undefined) dso.constellation = override.constellation;
  if (override.rating !== undefined) {
    dso.rating = override.rating;
    invalidateDSOImportanceRank(); // rating drives the importance rank / density gate
  }
  if (override.difficulty !== undefined) dso.difficulty = override.difficulty;
  if (override.type !== undefined) dso.type = override.type;
}

function resetDsoToBase(dso: DSO, lang: string): void {
  const base = baseValues.get(dso.id);
  if (!base) return;
  if (dso.ra !== base.ra || dso.dec !== base.dec) {
    dso.ra = base.ra;
    dso.dec = base.dec;
    invalidateProjections();
  }
  dso.displayName = computeDisplayName(base.nameFr, base.nameEn, base.nameEs, base.nameDe, lang);
  dso.constellation = base.constellation;
  if (dso.rating !== base.rating) invalidateDSOImportanceRank();
  dso.rating = base.rating;
  dso.difficulty = base.difficulty;
  dso.type = base.type;
}

export function applyAndStoreSingleOverride(dsoId: string, override: DSOUserOverride): void {
  const lang = getLang();
  userOverrides.set(dsoId, override);
  const dso = dsoById.get(dsoId.toUpperCase());
  if (dso) applyUserOverrideToDso(dso, override, lang);
}

export function resetDsoToBaseValues(dsoId: string): void {
  const lang = getLang();
  userOverrides.delete(dsoId);
  const dso = dsoById.get(dsoId.toUpperCase());
  if (dso) resetDsoToBase(dso, lang);
}

/** Returns the original catalog values for a DSO (before any user override). */
export function getDSOCatalogBaseValues(dsoId: string): DSOBaseValues | null {
  return baseValues.get(dsoId) ?? null;
}

/** Returns the currently applied user override for a DSO, if any. */
export function getUserOverride(dsoId: string): DSOUserOverride | undefined {
  return userOverrides.get(dsoId);
}

export async function reloadUserOverrides(): Promise<void> {
  const overridesMap = await getDsoOverrides();
  const lang = getLang();
  // Reset all currently-overridden DSOs
  for (const id of userOverrides.keys()) {
    const dso = dsoById.get(id.toUpperCase());
    if (dso) resetDsoToBase(dso, lang);
  }
  for (const id of Object.keys(overridesMap)) {
    const dso = dsoById.get(id.toUpperCase());
    if (dso) resetDsoToBase(dso, lang);
  }
  // Apply new overrides
  userOverrides.clear();
  for (const [id, override] of Object.entries(overridesMap)) {
    userOverrides.set(id, override);
    const dso = dsoById.get(id.toUpperCase());
    if (dso) applyUserOverrideToDso(dso, override, lang);
  }
}

function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const d1 = dec1 * toRad;
  const d2 = dec2 * toRad;
  const dra = (ra2 - ra1) * toRad;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad;
}

export async function loadDSOCatalog(): Promise<void> {
  const json = await fetch('/data/dso.json').then((r) => r.json());

  const fields: string[] = json.fields;
  const idxId = fields.indexOf('id');
  const idxRa = fields.indexOf('ra');
  const idxDec = fields.indexOf('dec');
  const idxType = fields.indexOf('type');
  const idxMajAxis = fields.indexOf('majAxis');
  const idxMinAxis = fields.indexOf('minAxis');
  const idxPa = fields.indexOf('pa');
  const idxMag = fields.indexOf('mag');
  const idxNameFr = fields.indexOf('nameFr');
  const idxNameEn = fields.indexOf('nameEn');
  const idxNameEs = fields.indexOf('nameEs');
  const idxNameDe = fields.indexOf('nameDe');
  const idxCatalogs = fields.indexOf('catalogs');
  const idxEmissionLines = fields.indexOf('emissionLines');
  const idxConstellation = fields.indexOf('constellation');
  const idxRating = fields.indexOf('rating');
  const idxDifficulty = fields.indexOf('difficulty');
  const idxContainerId = fields.indexOf('containerId');
  const idxPriority = fields.indexOf('priority');

  const lang = getLang();

  for (const row of json.data) {
    const nameFr: string | null = row[idxNameFr];
    const nameEn: string | null = idxNameEn >= 0 ? row[idxNameEn] : null;
    const nameEs: string | null = idxNameEs >= 0 ? row[idxNameEs] : null;
    const nameDe: string | null = idxNameDe >= 0 ? row[idxNameDe] : null;
    let displayName: string | null;
    if (lang === 'fr') displayName = nameFr;
    else if (lang === 'es') displayName = nameEs || nameEn || nameFr;
    else if (lang === 'de') displayName = nameDe || nameEn || nameFr;
    else displayName = nameEn || nameFr;

    // catalogs field: array of all catalog IDs sorted by display priority, or fall back to [id].
    // The object's own id always sorts first — it's the canonical designation regardless of
    // which catalog family it belongs to, and callers rely on catalogs[0] === id (ID row,
    // "also known as" cross-refs). A merged-in alias from a higher-priority family (e.g. an
    // SH2 alias on an Abell-primary object) must not displace it.
    const catalogs: string[] =
      idxCatalogs >= 0 && Array.isArray(row[idxCatalogs])
        ? [...row[idxCatalogs]].sort((a: string, b: string) => {
            if (a === row[idxId]) return -1;
            if (b === row[idxId]) return 1;
            return catalogSortKey(a) - catalogSortKey(b);
          })
        : [row[idxId]];

    const constellation: string | null =
      idxConstellation >= 0 ? (row[idxConstellation] ?? null) : null;
    const rating: number | null = idxRating >= 0 ? (row[idxRating] ?? null) : null;
    const difficulty: number | null = idxDifficulty >= 0 ? (row[idxDifficulty] ?? null) : null;

    const dso: DSO = {
      id: row[idxId],
      ra: row[idxRa],
      dec: row[idxDec],
      type: row[idxType] as DSOType,
      majAxis: row[idxMajAxis],
      minAxis: row[idxMinAxis],
      pa: row[idxPa] ?? 0,
      mag: row[idxMag],
      displayName,
      catalogs,
      emissionLines: idxEmissionLines >= 0 ? (row[idxEmissionLines] ?? null) : null,
      constellation,
      rating,
      difficulty,
      containerId: idxContainerId >= 0 ? (row[idxContainerId] ?? null) : null,
      priority:
        idxPriority >= 0 ? (row[idxPriority] ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
      // Catalog prefix is a pure function of the (immutable) id; precompute it once
      // here so the per-frame selection loop reads a field instead of re-running the
      // regex/startsWith chain for every DSO on every render.
      catalog: getDSOCatalog(row[idxId]),
    };
    dsos.push(dso);

    // Capture base values for override/reset support
    baseValues.set(dso.id, {
      ra: dso.ra,
      dec: dso.dec,
      nameFr,
      nameEn,
      nameEs,
      nameDe,
      constellation,
      rating,
      difficulty,
      type: dso.type,
    });

    // Index by primary id and by every catalog alias
    for (const catId of catalogs) {
      dsoById.set(catId.toUpperCase(), dso);
    }
  }

  // Apply any existing user overrides from the server
  try {
    const overridesMap = await getDsoOverrides();
    for (const [id, override] of Object.entries(overridesMap)) {
      userOverrides.set(id, override);
      const dso = dsoById.get(id.toUpperCase());
      if (dso) applyUserOverrideToDso(dso, override, lang);
    }
  } catch {
    // Silently ignore if user overrides can't be loaded
  }

  // Fresh catalog: drop any stale importance rank so it rebuilds from the new set.
  invalidateDSOImportanceRank();

  // Already sorted by magnitude in the JSON (brightest first)
}

export function getDSOs(): DSO[] {
  return dsos;
}

export function getDSOById(id: string): DSO | undefined {
  return dsoById.get(id.toUpperCase());
}

/**
 * Intrinsic photographic importance of a DSO (higher = more important). Mirrors the
 * build-time `dsoImportance` in scripts/add-ratings.mjs: photographic rating dominates,
 * brightness (lower mag) breaks ties. Position-independent, so ranking by it and then
 * area-weighting the count gate makes on-screen DSO density track the true sky density
 * (dense regions keep proportionally more of the top-N) with the projection bias removed.
 */
export function dsoImportance(d: DSO): number {
  return (d.rating ?? 0) * 100 - (d.mag ?? 99) * 0.01;
}

/**
 * Global rank of every DSO by {@link dsoImportance} (0 = most important), keyed by id.
 * Built lazily from the current catalog and cached until {@link invalidateDSOImportanceRank}.
 * Used by the area-weighted DSO density gate (see SkyMap.selectRenderedDSOs).
 */
export function getDSOImportanceRank(): Map<string, number> {
  if (!dsoImportanceRank) {
    const sorted = [...dsos].sort((a, b) => dsoImportance(b) - dsoImportance(a));
    dsoImportanceRank = new Map(sorted.map((d, i) => [d.id, i]));
  }
  return dsoImportanceRank;
}

/** Drop the cached importance rank so it rebuilds on next use — call whenever a DSO's
 *  rating changes (user override) so the density gate re-ranks. */
export function invalidateDSOImportanceRank(): void {
  dsoImportanceRank = null;
}

/** Priority order for picking the best display catalog ID (lower = higher priority). */
function catalogSortKey(id: string): number {
  if (/^M\d/.test(id)) return 0; // Messier
  if (id.startsWith('NGC')) return 1;
  if (id.startsWith('IC')) return 2;
  if (id.startsWith('SH2')) return 3;
  if (id.startsWith('LBN')) return 4;
  if (id.startsWith('LDN')) return 5;
  if (id.startsWith('vdB')) return 6;
  if (id.startsWith('Abell')) return 7;
  if (id.startsWith('LPN')) return 8;
  if (id.startsWith('Barnard')) return 9;
  return 10;
}

export type DSOCatalog =
  'M' | 'NGC' | 'IC' | 'SH2' | 'LBN' | 'LDN' | 'vdB' | 'Abell' | 'LPN' | 'Barnard';

/** Master catalog list — used by both the sky map toggles and the targets view. */
export const DSO_CATALOGS_ALL: DSOCatalog[] = [
  'M',
  'NGC',
  'IC',
  'SH2',
  'LBN',
  'LDN',
  'vdB',
  'Abell',
  'LPN',
  'Barnard',
];

export function getDSOCatalog(id: string): DSOCatalog | null {
  if (/^M\d/.test(id)) return 'M';
  if (id.startsWith('NGC')) return 'NGC';
  if (id.startsWith('IC')) return 'IC';
  if (id.startsWith('SH2')) return 'SH2';
  if (id.startsWith('LBN')) return 'LBN';
  if (id.startsWith('LDN')) return 'LDN';
  if (id.startsWith('vdB')) return 'vdB';
  if (id.startsWith('Abell')) return 'Abell';
  if (id.startsWith('LPN')) return 'LPN';
  if (id.startsWith('Barnard')) return 'Barnard';
  return null;
}

export function getDSOsNear(ra: number, dec: number, radiusDeg: number): DSO[] {
  // First pass: bounding box filter
  const decMin = dec - radiusDeg;
  const decMax = dec + radiusDeg;
  const result: DSO[] = [];

  for (const dso of dsos) {
    if (dso.dec < decMin || dso.dec > decMax) continue;
    if (angularDistance(ra, dec, dso.ra, dso.dec) <= radiusDeg) {
      result.push(dso);
    }
  }

  return result;
}

/**
 * Find all DSOs whose center falls within the image boundaries.
 *
 * @param photoToCanvas - Affine matrix mapping photo pixels → stereographic canvas projection units
 * @param imgWidth - Image width in pixels (photo coordinates)
 * @param imgHeight - Image height in pixels (photo coordinates)
 */
export function findDSOsInImage(
  photoToCanvas: AffineMatrix,
  imgWidth: number,
  imgHeight: number,
): DSO[] {
  // Invert the affine: canvas projection → photo pixels
  const { a, b, c, d, e, f } = photoToCanvas;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-30) return [];
  const inv: AffineMatrix = {
    a: d / det,
    b: -b / det,
    c: -c / det,
    d: a / det,
    e: (c * f - d * e) / det,
    f: (b * e - a * f) / det,
  };

  const result: DSO[] = [];
  for (const dso of dsos) {
    const pt = project(dso.ra, dso.dec);
    const px = inv.a * pt.x + inv.c * pt.y + inv.e;
    const py = inv.b * pt.x + inv.d * pt.y + inv.f;
    if (px >= 0 && px <= imgWidth && py >= 0 && py <= imgHeight) {
      result.push(dso);
    }
  }
  return result;
}

/**
 * Derive the catalog DSO IDs that fall within an image from plate-solve
 * correspondences (each carrying a photo pixel + its sky RA/Dec). Used as a
 * fallback for solvers that don't return DSOs directly (WCS, ASTAP). Returns []
 * if fewer than 3 correspondences carry RA/Dec, the image size is unknown, or
 * the affine is degenerate.
 */
export function findDSOIdsFromCorrespondences(
  correspondences: PhotoCorrespondence[],
  imgWidth: number,
  imgHeight: number,
): string[] {
  if (!imgWidth || !imgHeight) return [];
  const photoPoints: { x: number; y: number }[] = [];
  const projPoints: { x: number; y: number }[] = [];
  for (const c of correspondences) {
    if (c.starRa == null || c.starDec == null) continue;
    photoPoints.push({ x: c.photoX, y: c.photoY });
    projPoints.push(project(c.starRa, c.starDec));
    if (photoPoints.length >= 3) break;
  }
  if (photoPoints.length < 3) return [];
  try {
    const aff = computeAffineTransform(
      photoPoints as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
      projPoints as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    );
    return findDSOsInImage(aff, imgWidth, imgHeight).map((d) => d.id);
  } catch {
    return [];
  }
}
