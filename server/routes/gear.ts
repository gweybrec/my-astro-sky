import fs from 'fs';
import path from 'path';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RESOURCES_DIR } from '../server-paths.js';
import {
  getAllCustomGear,
  upsertCustomGear as upsertCustomGearDB,
  deleteCustomGear as deleteCustomGearDB,
  deleteAllCustomGear as deleteAllCustomGearDB,
  getAllGearSetups,
  upsertGearSetup,
  updateGearSetupEnabled,
  deleteGearSetup,
  deleteAllGearSetups,
} from '../db.js';

export const gearRouter = express.Router();

// ─── Gear catalogs ────────────────────────────────────────────────────────────

// Built-in gear catalogs — loaded once at startup
const builtInTelescopes: object[] = JSON.parse(
  fs.readFileSync(path.join(RESOURCES_DIR, 'telescopes.json'), 'utf-8'),
);
const builtInCameras: object[] = JSON.parse(
  fs.readFileSync(path.join(RESOURCES_DIR, 'cameras.json'), 'utf-8'),
);
const builtInAccessories: object[] = JSON.parse(
  fs.readFileSync(path.join(RESOURCES_DIR, 'accessories.json'), 'utf-8'),
);
const builtInFilters: object[] = JSON.parse(
  fs.readFileSync(path.join(RESOURCES_DIR, 'filters.json'), 'utf-8'),
);

const byBrandModel = (a: any, b: any) =>
  `${a.brand ?? ''} ${a.model ?? ''}`.localeCompare(`${b.brand ?? ''} ${b.model ?? ''}`);

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
gearRouter.get('/api/telescopes', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter((g) => g.type === 'telescope')
      .map((g) => JSON.parse(g.data));
    res.json([...builtInTelescopes, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.get('/api/cameras', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter((g) => g.type === 'camera')
      .map((g) => JSON.parse(g.data));
    res.json([...builtInCameras, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.get('/api/accessories', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter((g) => g.type === 'accessory')
      .map((g) => JSON.parse(g.data));
    res.json([...builtInAccessories, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.get('/api/filters', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter((g) => g.type === 'filter')
      .map((g) => JSON.parse(g.data));
    res.json([...builtInFilters, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.post('/api/custom-gear', (req, res) => {
  try {
    const { type, data } = req.body as { type?: string; data?: object };
    if (!type || !['telescope', 'camera', 'accessory', 'filter'].includes(type)) {
      res
        .status(400)
        .json({ error: 'Invalid type — must be telescope, camera, accessory, or filter' });
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'Invalid data — must be a non-null object' });
      return;
    }
    const id = `custom-${uuidv4()}`;
    upsertCustomGearDB(id, type as 'telescope' | 'camera' | 'accessory' | 'filter', {
      ...data,
      id,
    });
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.delete('/api/custom-gear/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id.startsWith('custom-')) {
      res.status(400).json({ error: 'Only custom gear items can be deleted' });
      return;
    }
    const deleted = deleteCustomGearDB(id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
gearRouter.delete('/api/custom-gear', (_req, res) => {
  try {
    const deleted = deleteAllCustomGearDB();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] Custom gear delete failed', err);
    res.status(500).json({ error: err.message });
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
gearRouter.get('/api/gear-setups', (_req, res) => {
  try {
    const rows = getAllGearSetups();
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        telescopeId: r.telescope_id,
        cameraId: r.camera_id,
        accessoryId: r.accessory_id ?? null,
        enabled: r.enabled === 1,
      })),
    );
  } catch (err: any) {
    console.error('[GearSetups] Failed to list setups', err);
    res.status(500).json({ error: err.message });
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
gearRouter.post('/api/gear-setups', (req, res) => {
  try {
    const { name, telescopeId, cameraId, accessoryId, enabled } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required', code: 'MISSING_NAME' });
      return;
    }
    if (!telescopeId || typeof telescopeId !== 'string') {
      res.status(400).json({ error: 'telescopeId is required', code: 'MISSING_TELESCOPE' });
      return;
    }
    if (!cameraId || typeof cameraId !== 'string') {
      res.status(400).json({ error: 'cameraId is required', code: 'MISSING_CAMERA' });
      return;
    }
    const id = `setup-${uuidv4()}`;
    upsertGearSetup({
      id,
      name: name.trim(),
      telescope_id: telescopeId,
      camera_id: cameraId,
      accessory_id: accessoryId ?? null,
      enabled: enabled !== false ? 1 : 0,
    });
    res.json({ id });
  } catch (err: any) {
    console.error('[GearSetups] Failed to create setup', err);
    res.status(500).json({ error: err.message });
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
gearRouter.put('/api/gear-setups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, telescopeId, cameraId, accessoryId, enabled } = req.body as any;
    if (
      !name ||
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      !telescopeId ||
      !cameraId
    ) {
      res.status(400).json({ error: 'name, telescopeId, and cameraId are required' });
      return;
    }
    upsertGearSetup({
      id,
      name: name.trim(),
      telescope_id: telescopeId,
      camera_id: cameraId,
      accessory_id: accessoryId ?? null,
      enabled: enabled !== false ? 1 : 0,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to update setup', err);
    res.status(500).json({ error: err.message });
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
gearRouter.patch('/api/gear-setups/:id/enabled', (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body as any;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' });
      return;
    }
    const ok = updateGearSetupEnabled(id, enabled);
    if (!ok) {
      res.status(404).json({ error: 'Setup not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to update enabled state', err);
    res.status(500).json({ error: err.message });
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
gearRouter.delete('/api/gear-setups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const ok = deleteGearSetup(id);
    if (!ok) {
      res.status(404).json({ error: 'Setup not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to delete setup', err);
    res.status(500).json({ error: err.message });
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
gearRouter.delete('/api/gear-setups', (_req, res) => {
  try {
    const deleted = deleteAllGearSetups();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[GearSetups] Failed to delete all setups', err);
    res.status(500).json({ error: err.message });
  }
});
