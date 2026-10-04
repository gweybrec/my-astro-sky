import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { planEntryToApi, planMosaicToApi, PLAN_SORT_KEYS } from './mappers.js';
import {
  getPlans,
  getPlan,
  getAllPlanEntries,
  createPlan,
  renamePlan,
  updatePlanSettings,
  updatePlanSort,
  deletePlan,
  reorderPlans,
  planEntryExists,
  addPlanEntry,
  nextPlanEntryPosition,
  removePlanEntry,
  reorderPlanEntries,
  updatePlanEntryFrame,
  getAllPlanMosaics,
  getPlanMosaic,
  createPlanMosaic,
  updatePlanMosaic,
  deletePlanMosaic,
  type PlanEntryRow,
  type PlanMosaicRow,
  type MosaicTileInput,
} from '../db.js';

export const plansRouter = express.Router();

// ─── Night plans ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/plans:
 *   get:
 *     summary: Get all night plans with their entries
 *     responses:
 *       200:
 *         description: Array of plans, each with nested entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   position: { type: integer }
 *                   entries:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         dsoId: { type: string }
 *                         position: { type: integer }
 *                         paDeg: { type: number, nullable: true }
 *                         notes: { type: string, nullable: true }
 *       500:
 *         description: Server error
 */
plansRouter.get('/api/plans', (_req, res) => {
  try {
    const entries = getAllPlanEntries();
    const byPlan = new Map<string, PlanEntryRow[]>();
    for (const e of entries) {
      const list = byPlan.get(e.plan_id) ?? [];
      list.push(e);
      byPlan.set(e.plan_id, list);
    }
    const mosaicsByPlan = new Map<string, PlanMosaicRow[]>();
    for (const m of getAllPlanMosaics()) {
      const list = mosaicsByPlan.get(m.plan_id) ?? [];
      list.push(m);
      mosaicsByPlan.set(m.plan_id, list);
    }
    res.json(
      getPlans().map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nightOf: p.night_of ?? null,
        setupId: p.setup_id ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        sortBy: p.sort_by ?? 'transit',
        entries: (byPlan.get(p.id) ?? []).map(planEntryToApi),
        mosaics: (mosaicsByPlan.get(p.id) ?? []).map(planMosaicToApi),
      })),
    );
  } catch (err: any) {
    console.error('[Plans] Failed to list plans', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans:
 *   post:
 *     summary: Create a new night plan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name for the plan
 *     responses:
 *       200:
 *         description: Plan created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.post('/api/plans', (req, res) => {
  try {
    const { name } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const id = `plan-${uuidv4()}`;
    const position = getPlans().length;
    createPlan({
      id,
      name: name.trim(),
      position,
      created_at: new Date().toISOString(),
      night_of: null,
      setup_id: null,
      lat: null,
      lon: null,
    });
    res.json({ id });
  } catch (err: any) {
    console.error('[Plans] Failed to create plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/order:
 *   put:
 *     summary: Reorder all plans
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: Plan IDs in the desired order
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: ids must be an array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.put('/api/plans/order', (req, res) => {
  try {
    const { ids } = req.body as any;
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array' });
      return;
    }
    reorderPlans(ids);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to reorder plans', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}:
 *   put:
 *     summary: Rename a night plan or update its settings (night/setup/location/sort)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               nightOf: { type: string, nullable: true }
 *               setupId: { type: string, nullable: true }
 *               lat: { type: number, nullable: true }
 *               lon: { type: number, nullable: true }
 *               sortBy:
 *                 type: string
 *                 enum: [transit, altitude, rating, magnitude, size, name, difficulty, window]
 *                 description: Objects-list sort key (drives the UI list and exported PDF order)
 *     responses:
 *       200:
 *         description: Plan renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: Missing name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.put('/api/plans/:id', (req, res) => {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as any;
    const hasName = 'name' in body;
    const hasSettings = 'nightOf' in body || 'setupId' in body || 'lat' in body || 'lon' in body;
    const hasSort = 'sortBy' in body;
    if (!hasName && !hasSettings && !hasSort) {
      res
        .status(400)
        .json({ error: 'name, settings (nightOf/setupId/lat/lon), or sortBy required' });
      return;
    }
    const existing = getPlan(id);
    if (!existing) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    if (hasName) {
      const { name } = body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      renamePlan(id, name.trim());
    }
    if (hasSettings) {
      const nightOf = 'nightOf' in body ? body.nightOf || null : (existing.night_of ?? null);
      const setupId = 'setupId' in body ? body.setupId || null : (existing.setup_id ?? null);
      const lat =
        'lat' in body ? (typeof body.lat === 'number' ? body.lat : null) : (existing.lat ?? null);
      const lon =
        'lon' in body ? (typeof body.lon === 'number' ? body.lon : null) : (existing.lon ?? null);
      if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
        res.status(400).json({ error: 'lat must be between -90 and 90' });
        return;
      }
      if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
        res.status(400).json({ error: 'lon must be between -180 and 180' });
        return;
      }
      updatePlanSettings(id, nightOf, setupId, lat, lon);
    }
    if (hasSort) {
      const sortBy = body.sortBy;
      if (typeof sortBy !== 'string' || !PLAN_SORT_KEYS.includes(sortBy as any)) {
        res.status(400).json({ error: `sortBy must be one of: ${PLAN_SORT_KEYS.join(', ')}` });
        return;
      }
      updatePlanSort(id, sortBy);
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to update plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}:
 *   delete:
 *     summary: Delete a night plan and its entries
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     responses:
 *       200:
 *         description: Plan deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.delete('/api/plans/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!deletePlan(id)) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to delete plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries:
 *   post:
 *     summary: Add a target to a plan (DSO or custom location)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       description: Provide `dsoId` for a catalog target, or `ra`/`dec` for a custom-location frame on empty sky.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dsoId: { type: string, description: DSO catalog id (omit for a custom location) }
 *               ra: { type: number, description: Frame-centre right ascension (deg), required for a custom location }
 *               dec: { type: number, description: Frame-centre declination (deg), required for a custom location }
 *               paDeg: { type: number, description: Framing position angle (°E of N) }
 *     responses:
 *       200:
 *         description: Entry added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing dsoId or ra/dec
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       409:
 *         description: Target already in plan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string, enum: [DUPLICATE_ENTRY] }
 *       500:
 *         description: Server error
 */
plansRouter.post('/api/plans/:id/entries', (req, res) => {
  try {
    const { id } = req.params;
    const { dsoId, ra, dec, paDeg } = req.body as any;
    if (!getPlan(id)) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    if (dsoId == null) {
      // Custom-location entry (framed on empty sky): no DSO, ra/dec required.
      if (typeof ra !== 'number' || typeof dec !== 'number') {
        res.status(400).json({ error: 'dsoId or ra/dec is required' });
        return;
      }
    } else {
      if (typeof dsoId !== 'string') {
        res.status(400).json({ error: 'dsoId must be a string' });
        return;
      }
      if (planEntryExists(id, dsoId)) {
        res.status(409).json({ error: 'Target already in plan', code: 'DUPLICATE_ENTRY' });
        return;
      }
    }
    const entryId = `pe-${uuidv4()}`;
    addPlanEntry({
      id: entryId,
      plan_id: id,
      dso_id: dsoId ?? null,
      position: nextPlanEntryPosition(id),
      pa_deg: typeof paDeg === 'number' ? paDeg : null,
      ra: typeof ra === 'number' ? ra : null,
      dec: typeof dec === 'number' ? dec : null,
      notes: null,
      mosaic_id: null,
    });
    res.json({ id: entryId });
  } catch (err: any) {
    console.error('[Plans] Failed to add entry', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/order:
 *   put:
 *     summary: Reorder the entries within a plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: Entry IDs in the desired order
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: ids must be an array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.put('/api/plans/:id/entries/order', (req, res) => {
  try {
    const { id } = req.params;
    const { ids } = req.body as any;
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array' });
      return;
    }
    reorderPlanEntries(id, ids);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to reorder entries', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/{entryId}:
 *   delete:
 *     summary: Remove a target from a plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *         description: Entry ID
 *     responses:
 *       200:
 *         description: Entry removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Entry not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.delete('/api/plans/:id/entries/:entryId', (req, res) => {
  try {
    const { entryId } = req.params;
    if (!removePlanEntry(entryId)) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to remove entry', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/{entryId}:
 *   patch:
 *     summary: Update a plan entry's framing (position angle, frame centre, and target DSO)
 *     description: >
 *       Updates only the fields present in the body. `paDeg` sets the framing
 *       rotation. `ra`/`dec` set the frame-centre sky coordinates. `dsoId` sets
 *       the target DSO (or null for a custom location with no catalogued object).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *         description: Entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paDeg:
 *                 type: number
 *                 nullable: true
 *                 description: Framing position angle in degrees east of celestial north (0–360), or null to clear
 *               ra:
 *                 type: number
 *                 nullable: true
 *                 description: Frame-centre right ascension in degrees, or null to clear (use the DSO position)
 *               dec:
 *                 type: number
 *                 nullable: true
 *                 description: Frame-centre declination in degrees, or null to clear
 *               dsoId:
 *                 type: string
 *                 nullable: true
 *                 description: Target DSO id, or null for a custom location
 *               mosaicWDeg:
 *                 type: number
 *                 nullable: true
 *                 description: Smart-scope single-frame mosaic width in degrees, or null to render at native FOV
 *               mosaicHDeg:
 *                 type: number
 *                 nullable: true
 *                 description: Smart-scope single-frame mosaic height in degrees, or null to render at native FOV
 *     responses:
 *       200:
 *         description: Entry updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: A provided field has the wrong type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Entry not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
plansRouter.patch('/api/plans/:id/entries/:entryId', (req, res) => {
  try {
    const { entryId } = req.params;
    const body = req.body as Record<string, unknown>;
    const fields: {
      ra?: number | null;
      dec?: number | null;
      paDeg?: number | null;
      dsoId?: string | null;
      mosaicWDeg?: number | null;
      mosaicHDeg?: number | null;
      observationWindows?: unknown;
    } = {};

    if ('paDeg' in body) {
      if (body.paDeg !== null && typeof body.paDeg !== 'number') {
        res.status(400).json({ error: 'paDeg must be a number or null' });
        return;
      }
      fields.paDeg = body.paDeg as number | null;
    }
    if ('ra' in body) {
      if (body.ra !== null && typeof body.ra !== 'number') {
        res.status(400).json({ error: 'ra must be a number or null' });
        return;
      }
      fields.ra = body.ra as number | null;
    }
    if ('dec' in body) {
      if (body.dec !== null && typeof body.dec !== 'number') {
        res.status(400).json({ error: 'dec must be a number or null' });
        return;
      }
      fields.dec = body.dec as number | null;
    }
    if ('dsoId' in body) {
      if (body.dsoId !== null && typeof body.dsoId !== 'string') {
        res.status(400).json({ error: 'dsoId must be a string or null' });
        return;
      }
      fields.dsoId = body.dsoId as string | null;
    }
    if ('mosaicWDeg' in body) {
      if (body.mosaicWDeg !== null && typeof body.mosaicWDeg !== 'number') {
        res.status(400).json({ error: 'mosaicWDeg must be a number or null' });
        return;
      }
      fields.mosaicWDeg = body.mosaicWDeg as number | null;
    }
    if ('mosaicHDeg' in body) {
      if (body.mosaicHDeg !== null && typeof body.mosaicHDeg !== 'number') {
        res.status(400).json({ error: 'mosaicHDeg must be a number or null' });
        return;
      }
      fields.mosaicHDeg = body.mosaicHDeg as number | null;
    }
    if ('observationWindows' in body) {
      if (!Array.isArray(body.observationWindows)) {
        res.status(400).json({ error: 'observationWindows must be an array' });
        return;
      }
      // Re-validated and serialised inside updatePlanEntryFrame via sanitizeObservationWindows.
      fields.observationWindows = body.observationWindows;
    }

    if (Object.keys(fields).length === 0) {
      res.status(400).json({ error: 'No updatable fields provided' });
      return;
    }
    if (!updatePlanEntryFrame(entryId, fields)) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to update entry PA', err);
    res.status(500).json({ error: err.message });
  }
});

/** Validate and coerce a mosaic request body (shared by POST and PUT). */
function parseMosaicBody(body: Record<string, unknown>):
  | { error: string }
  | {
      dsoId: string | null;
      name: string | undefined;
      centerRa: number;
      centerDec: number;
      paDeg: number;
      overlapPct: number;
      cols: number;
      rows: number;
      tiles: MosaicTileInput[];
      replaceEntryIds: string[];
    } {
  const {
    dsoId,
    name,
    centerRa,
    centerDec,
    paDeg,
    overlapPct,
    cols,
    rows,
    tiles,
    replaceEntryIds,
  } = body as any;
  if (typeof centerRa !== 'number' || typeof centerDec !== 'number')
    return { error: 'centerRa/centerDec must be numbers' };
  if (!Array.isArray(tiles) || tiles.length === 0)
    return { error: 'tiles must be a non-empty array' };
  const cleanTiles: MosaicTileInput[] = [];
  for (const t of tiles) {
    if (typeof t?.ra !== 'number' || typeof t?.dec !== 'number')
      return { error: 'each tile needs numeric ra/dec' };
    cleanTiles.push({ ra: t.ra, dec: t.dec, paDeg: typeof t.paDeg === 'number' ? t.paDeg : null });
  }
  return {
    dsoId: typeof dsoId === 'string' ? dsoId : null,
    // undefined → "don't touch the stored name" (background drags/transforms).
    name: typeof name === 'string' ? name : undefined,
    centerRa,
    centerDec,
    paDeg: typeof paDeg === 'number' ? paDeg : 0,
    // Clamp to the same sane ranges mosaic.ts enforces at compute time.
    overlapPct: typeof overlapPct === 'number' ? Math.min(90, Math.max(0, overlapPct)) : 20,
    cols: Number.isInteger(cols) ? Math.max(1, cols) : Math.max(1, cleanTiles.length),
    rows: Number.isInteger(rows) ? Math.max(1, rows) : 1,
    tiles: cleanTiles,
    replaceEntryIds: Array.isArray(replaceEntryIds)
      ? replaceEntryIds.filter((x: unknown): x is string => typeof x === 'string')
      : [],
  };
}

/**
 * @swagger
 * /api/plans/{id}/mosaics:
 *   post:
 *     summary: Create a mosaic (a group of tile frames covering one target)
 *     description: >
 *       The client computes the tile centres from the gear FOV, overlap and
 *       region; the server persists the mosaic and its tiles as plan entries
 *       tagged with the new mosaic id.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [centerRa, centerDec, tiles]
 *             properties:
 *               dsoId: { type: string, nullable: true, description: Target DSO id (null for a multi-DSO/free mosaic) }
 *               name: { type: string, description: User-supplied mosaic name }
 *               centerRa: { type: number, description: Mosaic centre RA (deg) }
 *               centerDec: { type: number, description: Mosaic centre Dec (deg) }
 *               paDeg: { type: number, description: Mosaic position angle (°E of N) }
 *               overlapPct: { type: number, description: Overlap percentage between tiles }
 *               cols: { type: integer, description: Grid columns }
 *               rows: { type: integer, description: Grid rows }
 *               tiles:
 *                 type: array
 *                 description: Per-tile sky centres
 *                 items:
 *                   type: object
 *                   properties:
 *                     ra: { type: number }
 *                     dec: { type: number }
 *                     paDeg: { type: number, nullable: true }
 *     responses:
 *       200:
 *         description: Mosaic created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400: { description: Invalid body }
 *       404: { description: Plan not found }
 *       500: { description: Server error }
 */
plansRouter.post('/api/plans/:id/mosaics', (req, res) => {
  try {
    const { id } = req.params;
    if (!getPlan(id)) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    const parsed = parseMosaicBody(req.body as Record<string, unknown>);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const mosaicId = `mo-${uuidv4()}`;
    createPlanMosaic(
      {
        id: mosaicId,
        plan_id: id,
        dso_id: parsed.dsoId,
        name: parsed.name ?? null,
        center_ra: parsed.centerRa,
        center_dec: parsed.centerDec,
        pa_deg: parsed.paDeg,
        overlap_pct: parsed.overlapPct,
        cols: parsed.cols,
        rows: parsed.rows,
      },
      parsed.tiles,
      parsed.replaceEntryIds,
    );
    res.json({ id: mosaicId });
  } catch (err: any) {
    console.error('[Plans] Failed to create mosaic', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/mosaics/{mosaicId}:
 *   put:
 *     summary: Replace a mosaic's parameters and tile set
 *     description: Updates the mosaic row and replaces all of its tile entries with the supplied tiles.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: mosaicId
 *         required: true
 *         schema: { type: string }
 *         description: Mosaic ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [centerRa, centerDec, tiles]
 *             properties:
 *               dsoId: { type: string, nullable: true }
 *               name: { type: string, description: User-supplied mosaic name (omit to leave unchanged) }
 *               centerRa: { type: number }
 *               centerDec: { type: number }
 *               paDeg: { type: number }
 *               overlapPct: { type: number }
 *               cols: { type: integer }
 *               rows: { type: integer }
 *               tiles:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     ra: { type: number }
 *                     dec: { type: number }
 *                     paDeg: { type: number, nullable: true }
 *               replaceEntryIds:
 *                 type: array
 *                 description: Standalone plan entries to delete (absorbed into this mosaic by a merge)
 *                 items: { type: string }
 *     responses:
 *       200: { description: Mosaic updated }
 *       400: { description: Invalid body }
 *       404: { description: Mosaic not found }
 *       500: { description: Server error }
 */
plansRouter.put('/api/plans/:id/mosaics/:mosaicId', (req, res) => {
  try {
    const { id, mosaicId } = req.params;
    const existing = getPlanMosaic(mosaicId);
    if (!existing || existing.plan_id !== id) {
      res.status(404).json({ error: 'Mosaic not found' });
      return;
    }
    const parsed = parseMosaicBody(req.body as Record<string, unknown>);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const ok = updatePlanMosaic(
      mosaicId,
      {
        dsoId: parsed.dsoId,
        name: parsed.name,
        centerRa: parsed.centerRa,
        centerDec: parsed.centerDec,
        paDeg: parsed.paDeg,
        overlapPct: parsed.overlapPct,
        cols: parsed.cols,
        rows: parsed.rows,
      },
      parsed.tiles,
      parsed.replaceEntryIds,
    );
    if (!ok) {
      res.status(404).json({ error: 'Mosaic not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to update mosaic', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/mosaics/{mosaicId}:
 *   delete:
 *     summary: Delete a mosaic and all of its tile frames
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: mosaicId
 *         required: true
 *         schema: { type: string }
 *         description: Mosaic ID
 *     responses:
 *       200: { description: Mosaic deleted }
 *       404: { description: Mosaic not found }
 *       500: { description: Server error }
 */
plansRouter.delete('/api/plans/:id/mosaics/:mosaicId', (req, res) => {
  try {
    const { id, mosaicId } = req.params;
    const existing = getPlanMosaic(mosaicId);
    if (!existing || existing.plan_id !== id) {
      res.status(404).json({ error: 'Mosaic not found' });
      return;
    }
    if (!deletePlanMosaic(mosaicId)) {
      res.status(404).json({ error: 'Mosaic not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to delete mosaic', err);
    res.status(500).json({ error: err.message });
  }
});
