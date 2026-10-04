import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAllSkyRegions, upsertSkyRegion, deleteSkyRegion } from '../db.js';
import { skyRegionToApi } from './mappers.js';

export const skyRegionsRouter = express.Router();

// ─── Sky regions ─────────────────────────────────────────────────────────────

function isValidRegionPoints(points: unknown): points is { azDeg: number; altDeg: number }[] {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        Number.isFinite((p as any).azDeg) &&
        Number.isFinite((p as any).altDeg),
    )
  );
}

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
skyRegionsRouter.get('/api/sky-regions', (_req, res) => {
  try {
    res.json(getAllSkyRegions().map(skyRegionToApi));
  } catch (err: any) {
    console.error('[SkyRegions] Failed to list regions', err);
    res.status(500).json({ error: err.message });
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
skyRegionsRouter.post('/api/sky-regions', (req, res) => {
  try {
    const { name, color, points } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required', code: 'MISSING_NAME' });
      return;
    }
    if (!isValidRegionPoints(points)) {
      res.status(400).json({ error: 'points must have at least 3 {azDeg,altDeg} vertices' });
      return;
    }
    const id = `region-${uuidv4()}`;
    const position = getAllSkyRegions().length;
    upsertSkyRegion({
      id,
      name: name.trim(),
      color: typeof color === 'string' && color.trim() ? color.trim() : '#4ea1ff',
      points: JSON.stringify(points),
      position,
    });
    res.json({ id });
  } catch (err: any) {
    console.error('[SkyRegions] Failed to create region', err);
    res.status(500).json({ error: err.message });
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
skyRegionsRouter.patch('/api/sky-regions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAllSkyRegions().find((r) => r.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }
    const { name, color, points, position } = req.body as any;
    upsertSkyRegion({
      id,
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      color: typeof color === 'string' && color.trim() ? color.trim() : existing.color,
      points: isValidRegionPoints(points) ? JSON.stringify(points) : existing.points,
      position: Number.isFinite(position) ? Number(position) : existing.position,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[SkyRegions] Failed to update region', err);
    res.status(500).json({ error: err.message });
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
skyRegionsRouter.delete('/api/sky-regions/:id', (req, res) => {
  try {
    const ok = deleteSkyRegion(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[SkyRegions] Failed to delete region', err);
    res.status(500).json({ error: err.message });
  }
});
