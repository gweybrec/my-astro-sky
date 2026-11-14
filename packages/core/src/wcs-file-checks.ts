/**
 * Checks that a solved or raw file read for a photo is probably that photo's file: its size, its completeness, the
 * objects in its field, the centre, object name, focal length, pixel scale and gear names its header gives. Each
 * check runs only when both sides have the data. Nothing here blocks: the caller lists the warnings and lets the user
 * go on.
 */
import type { DSO, PlateSolveResult } from './types';
import type { FitsHeaderFacts } from './fits-header';
import type { SetupOptics } from './gear-catalog';
import { findDSOsInImage, getDSOById, sortDsoIdsByImportance } from './catalog/dso-registry';
import { fitPhotoSkyModel, pixelScaleDeg, type PhotoSkyModel } from './photo-sky-model';

export type WcsWarning =
  | { kind: 'dimensions'; sourceW: number; sourceH: number; targetW: number; targetH: number }
  | { kind: 'truncated' }
  /** The photo's main object is not in the file's field. */
  | { kind: 'mainObject'; dsoId: string }
  /** Messier objects of the photo that are not in the file's field. */
  | { kind: 'messierMissing'; dsoIds: string[] }
  /** Messier objects in the file's field that the photo does not have. */
  | { kind: 'messierExtra'; dsoIds: string[] }
  /** The centre the header gives is outside the placed photo. */
  | { kind: 'centerOutside' }
  | { kind: 'object'; object: string }
  | { kind: 'focalLength'; headerMm: number; setupMm: number }
  | { kind: 'pixelScale'; fileArcsec: number; setupArcsec: number }
  | { kind: 'telescope'; header: string }
  | { kind: 'instrument'; header: string };

/** What is known of the photo the file is read for. */
export interface WcsCheckContext {
  /** The photo's objects (as entered so far). */
  dsoIds: readonly string[];
  /** The photo's placement, null when it is not placed. */
  skyModel: PhotoSkyModel | null;
  /** The size of the displayed photo (the size the file's correspondences were scaled to). */
  width: number;
  height: number;
  /** The optics of the photo's gear setup, null without one. */
  setup: SetupOptics | null;
}

/** Relative tolerance of the focal length and pixel scale checks. */
const OPTICS_TOLERANCE = 0.1;
/** Margin around a field, as a fraction of its larger side, so that an object on the edge is not a difference. */
const FIELD_MARGIN = 0.05;

const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / b <= OPTICS_TOLERANCE;

/** True when the object (its extent included) falls in the field of `model`, with a small margin. */
function inField(model: PhotoSkyModel, dso: DSO, width: number, height: number): boolean {
  const p = model.toPixel(dso.ra, dso.dec);
  if (!p) return false;
  const scale = pixelScaleDeg(model);
  const radiusPx = scale > 0 ? (dso.majAxis ?? 0) / 60 / 2 / scale : 0;
  const m = FIELD_MARGIN * Math.max(width, height) + radiusPx;
  return p.x >= -m && p.x <= width + m && p.y >= -m && p.y <= height + m;
}

const isMessier = (dso: DSO) => dso.catalogs.some((c) => /^M\d+$/i.test(c));

/** The file's placement from its correspondences (scaled to the photo's size), null without enough of them. */
function fileModel(result: PlateSolveResult, width: number, height: number): PhotoSkyModel | null {
  if (!result.success || !width || !height) return null;
  const points = (result.correspondences ?? []).filter(
    (c) => c.starRa != null && c.starDec != null,
  );
  if (points.length < 3) return null;
  try {
    return fitPhotoSkyModel(
      points.map((c) => ({ x: c.photoX, y: c.photoY })),
      points.map((c) => ({ ra: c.starRa!, dec: c.starDec! })),
      width,
      height,
    );
  } catch {
    return null;
  }
}

function objectWarnings(file: PhotoSkyModel, ctx: WcsCheckContext): WcsWarning[] {
  const out: WcsWarning[] = [];
  const { width, height } = ctx;
  const own = ctx.dsoIds.map((id) => getDSOById(id)).filter((d): d is DSO => !!d);

  const main = sortDsoIdsByImportance(ctx.dsoIds)
    .map((id) => getDSOById(id))
    .find((d): d is DSO => !!d);
  if (main && !isMessier(main) && !inField(file, main, width, height)) {
    out.push({ kind: 'mainObject', dsoId: main.id });
  }

  // Messier objects: the photo's (entered, and in its field when it is placed) against those in the file's field.
  const photoMessier = new Map<string, DSO>();
  for (const d of own) if (isMessier(d)) photoMessier.set(d.id, d);
  if (ctx.skyModel) {
    for (const d of findDSOsInImage(ctx.skyModel, width, height)) {
      if (isMessier(d)) photoMessier.set(d.id, d);
    }
  }
  const missing = [...photoMessier.values()]
    .filter((d) => !inField(file, d, width, height))
    .map((d) => d.id);
  const extra = findDSOsInImage(file, width, height)
    .filter((d) => isMessier(d) && !photoMessier.has(d.id))
    .filter((d) => !ctx.skyModel || !inField(ctx.skyModel, d, width, height))
    .map((d) => d.id);
  if (missing.length > 0) out.push({ kind: 'messierMissing', dsoIds: missing });
  if (extra.length > 0) out.push({ kind: 'messierExtra', dsoIds: extra });
  return out;
}

/** Lower case, accents, spaces and punctuation removed: "M 63" → "m63", "Sh2-155" → "sh2155". */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** OBJECT values that name no object. */
const NO_OBJECT = new Set(['', 'unknown', 'unk', 'none', 'noname', 'object', 'target', 'light']);

/** True when `object` (normalised) starts with `name` and does not go on with a digit ("m63x" yes, "m631" no). */
function startsWithName(object: string, name: string): boolean {
  if (name.length < 2 || !object.startsWith(name)) return false;
  return object.length === name.length || !/\d/.test(object[name.length]);
}

/**
 * True when the OBJECT value names one of the objects: its catalogue ids or its name, either way round
 * ("M 63 ATR533C C11EF1.9" names M63, "Whirlpool" names "Whirlpool Galaxy").
 */
export function objectMatches(object: string, candidates: readonly DSO[]): boolean {
  const o = normalizeName(object);
  return candidates.some((d) =>
    [d.id, ...d.catalogs, d.displayName ?? ''].some((raw) => {
      const n = normalizeName(raw);
      return startsWithName(o, n) || (o.length >= 4 && startsWithName(n, o));
    }),
  );
}

/** Model words of a name: words holding a digit, at least 3 characters ("314l", "s30", "2600mc"). */
function modelWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && /\d/.test(w));
}

/**
 * True when two gear names probably name the same thing: once normalised one contains the other, or they share a
 * model word. A brand alone does not count. "ATIK-314L: fw rev 3.01" matches "Atik 314L+", "S30_0289c34b" matches
 * "Seestar S30".
 */
export function gearNamesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  const words = new Set(modelWords(a));
  return modelWords(b).some((w) => words.has(w));
}

function setupNames(setup: SetupOptics): string[] {
  return [setup.telescopeName, setup.cameraName ?? '', setup.setupName].filter(Boolean);
}

function opticsWarnings(facts: FitsHeaderFacts, setup: SetupOptics): WcsWarning[] {
  const out: WcsWarning[] = [];
  const focal = facts.focalLengthMm;
  // The header may or may not count a reducer or barlow: either focal length is fine.
  if (focal && !near(focal, setup.nativeFocalMm) && !near(focal, setup.effectiveFocalMm)) {
    out.push({ kind: 'focalLength', headerMm: focal, setupMm: setup.effectiveFocalMm });
  }
  const scale = facts.pixelScaleArcsec;
  if (scale && setup.pixelSizeUm) {
    const pixel = setup.pixelSizeUm;
    const expected = (focalMm: number, bin: number) => (206.265 * pixel * bin) / focalMm;
    const bins = [...new Set([1, facts.binning ?? 1])];
    const ok = [setup.effectiveFocalMm, setup.nativeFocalMm].some((f) =>
      bins.some((bin) => near(scale, expected(f, bin))),
    );
    if (!ok) {
      out.push({
        kind: 'pixelScale',
        fileArcsec: scale,
        setupArcsec: expected(setup.effectiveFocalMm, 1),
      });
    }
  }
  const names = setupNames(setup);
  if (facts.telescope && !names.some((n) => gearNamesMatch(facts.telescope!, n))) {
    out.push({ kind: 'telescope', header: facts.telescope });
  }
  if (facts.instrument && !names.some((n) => gearNamesMatch(facts.instrument!, n))) {
    out.push({ kind: 'instrument', header: facts.instrument });
  }
  return out;
}

/** The warnings for a solved/raw file read for a photo (see the module comment), in the order they are listed. */
export function wcsFileWarnings(result: PlateSolveResult, ctx: WcsCheckContext): WcsWarning[] {
  const out: WcsWarning[] = [];
  const dim = result.dimensionWarning;
  if (dim?.aspectMismatch) {
    out.push({
      kind: 'dimensions',
      sourceW: dim.sourceW,
      sourceH: dim.sourceH,
      targetW: dim.targetW,
      targetH: dim.targetH,
    });
  }
  if (result.truncated) out.push({ kind: 'truncated' });

  const facts = result.facts ?? {};
  const file = fileModel(result, ctx.width, ctx.height);
  // A photo with no objects entered and no placement has nothing to compare the file's field with.
  const photoKnown = ctx.skyModel !== null || ctx.dsoIds.length > 0;
  if (file) {
    if (photoKnown) out.push(...objectWarnings(file, ctx));
  } else if (ctx.skyModel && facts.centerRa !== undefined && facts.centerDec !== undefined) {
    const p = ctx.skyModel.toPixel(facts.centerRa, facts.centerDec);
    const m = FIELD_MARGIN * Math.max(ctx.width, ctx.height);
    if (!p || p.x < -m || p.x > ctx.width + m || p.y < -m || p.y > ctx.height + m) {
      out.push({ kind: 'centerOutside' });
    }
  }

  if (facts.object && !NO_OBJECT.has(normalizeName(facts.object))) {
    const candidates = new Map<string, DSO>();
    for (const id of ctx.dsoIds) {
      const d = getDSOById(id);
      if (d) candidates.set(d.id, d);
    }
    if (ctx.skyModel) {
      for (const d of findDSOsInImage(ctx.skyModel, ctx.width, ctx.height)) candidates.set(d.id, d);
    }
    if (candidates.size > 0 && !objectMatches(facts.object, [...candidates.values()])) {
      out.push({ kind: 'object', object: facts.object });
    }
  }

  if (ctx.setup) out.push(...opticsWarnings(facts, ctx.setup));
  return out;
}

/**
 * The one saved setup the header points to: a telescope or camera name matching (see `gearNamesMatch`) and the focal
 * length within 10 % (native or effective); without FOCALLEN, both names must match. Null when none or several do.
 */
export function suggestGearSetup(
  facts: FitsHeaderFacts | undefined,
  setups: readonly SetupOptics[],
): string | null {
  if (!facts || (!facts.telescope && !facts.instrument)) return null;
  const matching = setups.filter((s) => {
    const names = setupNames(s);
    const hits = [facts.telescope, facts.instrument].filter(
      (h) => h && names.some((n) => gearNamesMatch(h, n)),
    ).length;
    if (hits === 0) return false;
    if (facts.focalLengthMm) {
      return (
        near(facts.focalLengthMm, s.nativeFocalMm) || near(facts.focalLengthMm, s.effectiveFocalMm)
      );
    }
    return hits === 2;
  });
  return matching.length === 1 ? matching[0].setupId : null;
}
