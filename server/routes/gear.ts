import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { CustomGearInput, CustomGearType, GearSetupInput } from '@myastrosky/core/domain/gear';
import { gear } from '../services.js';
import { sendError } from './http-errors.js';

export const gearRouter = express.Router();

// ─── Gear catalogs ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/telescopes:
 *   get:
 *     summary: List all telescopes (built-in + custom)
 *     description: Returns the full telescope catalog merged with any user-created custom telescopes.
 *     responses:
 *       200:
 *         description: Telescope list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
gearRouter.get('/api/telescopes', async (_req, res) => {
  try {
    res.json(await gear.listCatalog('telescope'));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/cameras:
 *   get:
 *     summary: List all cameras (built-in + custom)
 *     description: Returns the full camera catalog merged with any user-created custom cameras.
 *     responses:
 *       200:
 *         description: Camera list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
gearRouter.get('/api/cameras', async (_req, res) => {
  try {
    res.json(await gear.listCatalog('camera'));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/accessories:
 *   get:
 *     summary: List all optical accessories (built-in + custom)
 *     description: Returns the full accessory catalog merged with any user-created custom accessories.
 *     responses:
 *       200:
 *         description: Accessory list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
gearRouter.get('/api/accessories', async (_req, res) => {
  try {
    res.json(await gear.listCatalog('accessory'));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/filters:
 *   get:
 *     summary: List all imaging filters (built-in + custom)
 *     description: Returns the full filter catalog merged with any user-created custom filters. Consumed by the filter autocomplete on photo integration rows and on plan observation windows.
 *     responses:
 *       200:
 *         description: Filter list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
gearRouter.get('/api/filters', async (_req, res) => {
  try {
    res.json(await gear.listCatalog('filter'));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/custom-gear:
 *   post:
 *     summary: Create a custom telescope, camera, or accessory
 *     description: Saves a user-defined equipment item to the database. The item becomes available in the corresponding dropdown immediately.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - data
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [telescope, camera, accessory, filter]
 *                 description: Equipment category
 *               data:
 *                 type: object
 *                 description: Equipment fields matching the category schema (brand, model, and math-required fields are mandatory)
 *     responses:
 *       200:
 *         description: Custom gear item created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: custom-3f2504e0-4f89-11d3-9a0c-0305e82c3301
 *       400:
 *         description: Missing or invalid type or data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 */
gearRouter.post('/api/custom-gear', async (req, res) => {
  try {
    const { type, data } = req.body as { type: CustomGearType; data: CustomGearInput };
    res.json(await gear.addCustom(type, data));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/custom-gear/{id}:
 *   delete:
 *     summary: Delete a custom gear item
 *     description: Permanently removes a user-created equipment item. Built-in catalog items cannot be deleted via this endpoint.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom gear item id (must start with "custom-")
 *     responses:
 *       200:
 *         description: Custom gear item deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Attempt to delete a built-in (non-custom) item
 *       404:
 *         description: Custom gear item not found
 *       500:
 *         description: Server error
 */
gearRouter.delete('/api/custom-gear/:id', async (req, res) => {
  try {
    await gear.removeCustom(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/custom-gear:
 *   delete:
 *     summary: Delete all custom gear
 *     description: Removes all user-created custom gear items (telescopes, cameras, accessories) from the database. Built-in catalog items are unaffected.
 *     responses:
 *       200:
 *         description: All custom gear deleted successfully
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
gearRouter.delete('/api/custom-gear', async (_req, res) => {
  try {
    const deleted = await gear.removeAllCustom();
    res.json({ ok: true, deleted });
  } catch (err) {
    if (!isDomainError(err)) console.error('[DeleteAll] Custom gear delete failed', err);
    sendError(res, err);
  }
});

// ─── Gear setups ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/gear-setups:
 *   get:
 *     summary: Get all named gear setups
 *     responses:
 *       200:
 *         description: Array of gear setups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   telescopeId: { type: string }
 *                   cameraId: { type: string }
 *                   accessoryId: { type: string, nullable: true }
 *                   enabled: { type: boolean }
 *       500:
 *         description: Server error
 */
gearRouter.get('/api/gear-setups', async (_req, res) => {
  try {
    res.json(await gear.listSetups());
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to list setups', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/gear-setups:
 *   post:
 *     summary: Create a new named gear setup
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, telescopeId, cameraId]
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-provided setup name
 *               telescopeId:
 *                 type: string
 *               cameraId:
 *                 type: string
 *               accessoryId:
 *                 type: string
 *                 nullable: true
 *               enabled:
 *                 type: boolean
 *                 description: Whether the FOV frame is drawn on the sky map (defaults to true)
 *     responses:
 *       200:
 *         description: Setup created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string }
 *       500:
 *         description: Server error
 */
gearRouter.post('/api/gear-setups', async (req, res) => {
  try {
    res.json(await gear.createSetup(req.body as GearSetupInput));
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to create setup', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}:
 *   put:
 *     summary: Update a named gear setup (full replace)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, telescopeId, cameraId]
 *             properties:
 *               name: { type: string }
 *               telescopeId: { type: string }
 *               cameraId: { type: string }
 *               accessoryId: { type: string, nullable: true }
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Setup updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
gearRouter.put('/api/gear-setups/:id', async (req, res) => {
  try {
    await gear.replaceSetup(req.params.id, req.body as GearSetupInput);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to update setup', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}/enabled:
 *   patch:
 *     summary: Toggle enabled state of a gear setup
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Enabled state updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: enabled must be boolean
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Setup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
gearRouter.patch('/api/gear-setups/:id/enabled', async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    await gear.setSetupEnabled(req.params.id, enabled);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to update enabled state', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}:
 *   delete:
 *     summary: Delete a named gear setup
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     responses:
 *       200:
 *         description: Setup deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Setup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
gearRouter.delete('/api/gear-setups/:id', async (req, res) => {
  try {
    await gear.removeSetup(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to delete setup', err);
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/gear-setups:
 *   delete:
 *     summary: Delete all gear setups
 *     responses:
 *       200:
 *         description: All setups deleted
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
gearRouter.delete('/api/gear-setups', async (_req, res) => {
  try {
    const deleted = await gear.removeAllSetups();
    res.json({ ok: true, deleted });
  } catch (err) {
    if (!isDomainError(err)) console.error('[GearSetups] Failed to delete all setups', err);
    sendError(res, err);
  }
});
