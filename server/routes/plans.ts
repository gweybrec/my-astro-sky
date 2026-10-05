import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type {
  MosaicParams,
  PlanChanges,
  PlanEntryChanges,
  PlanEntryInput,
  PlanInput,
} from '@myastrosky/core/domain/plans';
import { plans } from '../services.js';
import { sendError } from './http-errors.js';

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
plansRouter.get('/api/plans', async (_req, res) => {
  try {
    res.json(await plans.list());
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to list plans', err);
    sendError(res, err);
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
plansRouter.post('/api/plans', async (req, res) => {
  try {
    const { name } = req.body as PlanInput;
    res.json(await plans.create({ name }));
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to create plan', err);
    sendError(res, err);
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
plansRouter.put('/api/plans/order', async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await plans.reorder(ids);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to reorder plans', err);
    sendError(res, err);
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
plansRouter.put('/api/plans/:id', async (req, res) => {
  try {
    await plans.update(req.params.id, (req.body ?? {}) as PlanChanges);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to update plan', err);
    sendError(res, err);
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
plansRouter.delete('/api/plans/:id', async (req, res) => {
  try {
    await plans.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to delete plan', err);
    sendError(res, err);
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
plansRouter.post('/api/plans/:id/entries', async (req, res) => {
  try {
    const { dsoId, ra, dec, paDeg } = req.body as PlanEntryInput;
    res.json(await plans.addEntry(req.params.id, { dsoId, ra, dec, paDeg }));
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to add entry', err);
    sendError(res, err);
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
plansRouter.put('/api/plans/:id/entries/order', async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await plans.reorderEntries(req.params.id, ids);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to reorder entries', err);
    sendError(res, err);
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
plansRouter.delete('/api/plans/:id/entries/:entryId', async (req, res) => {
  try {
    await plans.removeEntry(req.params.entryId);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to remove entry', err);
    sendError(res, err);
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
plansRouter.patch('/api/plans/:id/entries/:entryId', async (req, res) => {
  try {
    await plans.updateEntry(req.params.entryId, req.body as PlanEntryChanges);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to update entry PA', err);
    sendError(res, err);
  }
});

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
plansRouter.post('/api/plans/:id/mosaics', async (req, res) => {
  try {
    res.json(await plans.createMosaic(req.params.id, req.body as MosaicParams));
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to create mosaic', err);
    sendError(res, err);
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
plansRouter.put('/api/plans/:id/mosaics/:mosaicId', async (req, res) => {
  try {
    const { id, mosaicId } = req.params;
    await plans.updateMosaic(id, mosaicId, req.body as MosaicParams);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to update mosaic', err);
    sendError(res, err);
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
plansRouter.delete('/api/plans/:id/mosaics/:mosaicId', async (req, res) => {
  try {
    const { id, mosaicId } = req.params;
    await plans.removeMosaic(id, mosaicId);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[Plans] Failed to delete mosaic', err);
    sendError(res, err);
  }
});
