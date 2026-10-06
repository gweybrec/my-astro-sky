import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { SkyRegionChanges, SkyRegionInput } from '@myastrosky/core/domain/regions';
import { skyRegions } from '../services.js';
import { sendError } from './http-errors.js';

export const skyRegionsRouter = express.Router();

// ─── Sky regions ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/sky-regions:
 *   get:
 *     summary: Get all saved sky regions
 *     description: >
 *       Freehand Alt/Az polygons drawn on the Local Sky (zenith) view, used as a
 *       Targets search filter for "what I can actually see from my garden".
 *     responses:
 *       200:
 *         description: Array of regions ordered by position
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   color: { type: string }
 *                   points:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         azDeg: { type: number }
 *                         altDeg: { type: number }
 *                   position: { type: number }
 *       500:
 *         description: Server error
 */
skyRegionsRouter.get('/api/sky-regions', async (_req, res) => {
  try {
    res.json(await skyRegions.list());
  } catch (err) {
    if (!isDomainError(err)) console.error('[SkyRegions] Failed to list regions', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/sky-regions:
 *   post:
 *     summary: Create a new sky region
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, points]
 *             properties:
 *               name: { type: string }
 *               color: { type: string, description: "CSS color, e.g. #4ea1ff" }
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     azDeg: { type: number }
 *                     altDeg: { type: number }
 *     responses:
 *       200:
 *         description: Region created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing name or invalid points (needs at least 3 {azDeg,altDeg} vertices)
 *       500:
 *         description: Server error
 */
skyRegionsRouter.post('/api/sky-regions', async (req, res) => {
  try {
    res.json(await skyRegions.create(req.body as SkyRegionInput));
  } catch (err) {
    if (!isDomainError(err)) console.error('[SkyRegions] Failed to create region', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/sky-regions/{id}:
 *   patch:
 *     summary: Update a sky region (name/color/points/position)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               color: { type: string }
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     azDeg: { type: number }
 *                     altDeg: { type: number }
 *               position: { type: number }
 *     responses:
 *       200:
 *         description: Region updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Region not found
 *       500:
 *         description: Server error
 */
skyRegionsRouter.patch('/api/sky-regions/:id', async (req, res) => {
  try {
    await skyRegions.update(req.params.id, req.body as SkyRegionChanges);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[SkyRegions] Failed to update region', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/sky-regions/{id}:
 *   delete:
 *     summary: Delete a sky region
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Region deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Region not found
 *       500:
 *         description: Server error
 */
skyRegionsRouter.delete('/api/sky-regions/:id', async (req, res) => {
  try {
    await skyRegions.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[SkyRegions] Failed to delete region', err);
    sendError(res, err);
  }
});
