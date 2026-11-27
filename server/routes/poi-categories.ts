import express from 'express';
import type { PoiCategoryChanges, PoiCategoryInput } from '@myastrosky/core/domain/poi-categories';
import { poiCategories } from '../services.js';
import { sendError } from './http-errors.js';

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
poiCategoriesRouter.get('/api/poi-categories', async (_req, res) => {
  try {
    res.json(await poiCategories.list());
  } catch (err) {
    sendError(res, err, 'poi_categories_list_categories_failed');
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
poiCategoriesRouter.post('/api/poi-categories', async (req, res) => {
  try {
    res.json(await poiCategories.create(req.body as PoiCategoryInput));
  } catch (err) {
    sendError(res, err, 'poi_categories_create_category_failed');
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
poiCategoriesRouter.patch('/api/poi-categories/:id', async (req, res) => {
  try {
    await poiCategories.update(req.params.id, req.body as PoiCategoryChanges);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'poi_categories_update_category_failed');
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
poiCategoriesRouter.delete('/api/poi-categories/:id', async (req, res) => {
  try {
    await poiCategories.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'poi_categories_delete_category_failed');
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
poiCategoriesRouter.delete('/api/poi-categories', async (_req, res) => {
  try {
    res.json({ ok: true, deleted: await poiCategories.removeAll() });
  } catch (err) {
    sendError(res, err, 'poi_categories_delete_all_categories_failed');
  }
});
