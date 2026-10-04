import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllPoiCategories,
  upsertPoiCategory,
  deletePoiCategory,
  deleteAllPoiCategories,
} from '../db.js';
import { poiCategoryToApi } from './mappers.js';

export const poiCategoriesRouter = express.Router();

// ─── Points of Interest categories ──────────────────────────────────────────────

/**
 * @swagger
 * /api/poi-categories:
 *   get:
 *     summary: Get all Points-of-Interest categories
 *     responses:
 *       200:
 *         description: Array of categories ordered by position
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
 *                   position: { type: number }
 *       500:
 *         description: Server error
 */
poiCategoriesRouter.get('/api/poi-categories', (_req, res) => {
  try {
    res.json(getAllPoiCategories().map(poiCategoryToApi));
  } catch (err: any) {
    console.error('[PoiCategories] Failed to list categories', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/poi-categories:
 *   post:
 *     summary: Create a new Point-of-Interest category
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               color: { type: string, description: "CSS color, e.g. #4ea1ff" }
 *     responses:
 *       200:
 *         description: Category created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing name
 *       500:
 *         description: Server error
 */
poiCategoriesRouter.post('/api/poi-categories', (req, res) => {
  try {
    const { name, color } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required', code: 'MISSING_NAME' });
      return;
    }
    const id = `cat-${uuidv4()}`;
    const position = getAllPoiCategories().length;
    upsertPoiCategory({
      id,
      name: name.trim(),
      color: typeof color === 'string' && color.trim() ? color.trim() : '#888888',
      position,
    });
    res.json({ id });
  } catch (err: any) {
    console.error('[PoiCategories] Failed to create category', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/poi-categories/{id}:
 *   patch:
 *     summary: Update a Point-of-Interest category (name/color/position)
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
 *               position: { type: number }
 *     responses:
 *       200:
 *         description: Category updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Category not found
 *       500:
 *         description: Server error
 */
poiCategoriesRouter.patch('/api/poi-categories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAllPoiCategories().find((c) => c.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    const { name, color, position } = req.body as any;
    upsertPoiCategory({
      id,
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      color: typeof color === 'string' && color.trim() ? color.trim() : existing.color,
      position: Number.isFinite(position) ? Number(position) : existing.position,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[PoiCategories] Failed to update category', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/poi-categories/{id}:
 *   delete:
 *     summary: Delete a Point-of-Interest category
 *     description: >
 *       Photos keep any POIs that referenced this category; those POIs are shown
 *       under an "Uncategorized" group until re-tagged.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Category deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Category not found
 *       500:
 *         description: Server error
 */
poiCategoriesRouter.delete('/api/poi-categories/:id', (req, res) => {
  try {
    const ok = deletePoiCategory(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[PoiCategories] Failed to delete category', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/poi-categories:
 *   delete:
 *     summary: Delete all Point-of-Interest categories
 *     responses:
 *       200:
 *         description: All categories deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 deleted: { type: number }
 *       500:
 *         description: Server error
 */
poiCategoriesRouter.delete('/api/poi-categories', (_req, res) => {
  try {
    const deleted = deleteAllPoiCategories();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[PoiCategories] Failed to delete all categories', err);
    res.status(500).json({ error: err.message });
  }
});
