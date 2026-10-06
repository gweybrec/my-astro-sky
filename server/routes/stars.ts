import express from 'express';
import { stars } from '../services.js';
import { sendError } from './http-errors.js';

export const starsRouter = express.Router();

/**
 * @swagger
 * /api/stars/search:
 *   get:
 *     summary: Search stars by name or catalog identifier
 *     responses:
 *       200:
 *         description: Star search results returned successfully
 */
// --- Star search API ---
starsRouter.get('/api/stars/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = parseInt(String(req.query.limit), 10);
    res.json(await stars.search(q, limit));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/stars/nearby:
 *   get:
 *     summary: Search stars near a given position
 *     responses:
 *       200:
 *         description: Nearby stars returned successfully
 */
starsRouter.get('/api/stars/nearby', async (req, res) => {
  try {
    const ra = parseFloat(String(req.query.ra || '0'));
    const dec = parseFloat(String(req.query.dec || '0'));
    const radius = parseFloat(String(req.query.radius || '5'));
    const magLimit = parseFloat(String(req.query.magLimit || '10'));
    const limit = parseInt(String(req.query.limit), 10);

    res.json(await stars.nearby({ ra, dec, radius, magLimit, limit }));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /api/stars/{hip}:
 *   get:
 *     summary: Get deep star details by HIP identifier
 *     parameters:
 *       - in: path
 *         name: hip
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Star details returned successfully
 */
starsRouter.get('/api/stars/:hip', async (req, res) => {
  try {
    res.json(await stars.getByHip(parseInt(req.params.hip, 10)));
  } catch (err) {
    sendError(res, err);
  }
});
