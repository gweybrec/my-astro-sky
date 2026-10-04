import express from 'express';
import {
  getAllDsoOverrides,
  upsertDsoOverride as upsertDsoOverrideDB,
  deleteDsoOverride as deleteDsoOverrideDB,
  deleteAllDsoOverrides as deleteAllDsoOverridesDB,
} from '../db.js';
import { validateDsoOverrideCoords } from '../import-utils.js';

export const dsoOverridesRouter = express.Router();

/**
 * @swagger
 * /api/dso-overrides:
 *   get:
 *     summary: Get all DSO overrides
 *     responses:
 *       200:
 *         description: DSO override list returned successfully
 */
// ─── DSO user overrides ──────────────────────────────────────────────────────

dsoOverridesRouter.get('/api/dso-overrides', (_req, res) => {
  try {
    res.json(getAllDsoOverrides());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides/{id}:
 *   put:
 *     summary: Create or update a DSO override
 *     description: Create or update metadata overrides for a DSO (name, type, coordinates)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: DSO catalog identifier (e.g. "M1", "NGC253", "SH2-15")
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Override properties (name_fr, name_en, type, ra, dec, etc.)
 *     responses:
 *       200:
 *         description: DSO override saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid DSO id or override data
 *       500:
 *         description: Server error
 */
dsoOverridesRouter.put('/api/dso-overrides/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.length > 100) {
      res.status(400).json({ error: 'Invalid DSO id' });
      return;
    }
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'Invalid override data' });
      return;
    }
    const coordError = validateDsoOverrideCoords(data as Record<string, unknown>);
    if (coordError) {
      res.status(400).json(coordError);
      return;
    }
    upsertDsoOverrideDB(id, data);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides/{id}:
 *   delete:
 *     summary: Delete a DSO override
 *     description: Remove metadata overrides for a DSO, reverting to default catalog data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: DSO catalog identifier (e.g. "M1", "NGC253", "SH2-15")
 *     responses:
 *       200:
 *         description: DSO override deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Server error
 */
dsoOverridesRouter.delete('/api/dso-overrides/:id', (req, res) => {
  try {
    deleteDsoOverrideDB(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides:
 *   delete:
 *     summary: Delete all DSO overrides
 *     description: Removes all user-defined DSO metadata overrides from the database, reverting all DSOs to default catalog data.
 *     responses:
 *       200:
 *         description: All DSO overrides deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: number
 *       500:
 *         description: Server error
 */
dsoOverridesRouter.delete('/api/dso-overrides', (_req, res) => {
  try {
    const deleted = deleteAllDsoOverridesDB();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] DSO overrides delete failed', err);
    res.status(500).json({ error: err.message });
  }
});
