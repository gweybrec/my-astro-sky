import express from 'express';
import { searchDeepStars, getDeepStarByHip, searchStarsByPosition } from '../star-search.js';

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
starsRouter.get('/api/stars/search', (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10), 50);
    const results = searchDeepStars(q, limit);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
starsRouter.get('/api/stars/nearby', (req, res) => {
  try {
    const ra = parseFloat(String(req.query.ra || '0'));
    const dec = parseFloat(String(req.query.dec || '0'));
    const radius = parseFloat(String(req.query.radius || '5'));
    const magLimit = parseFloat(String(req.query.magLimit || '10'));
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20), 100);

    const results = searchStarsByPosition(ra, dec, radius, magLimit, limit);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
starsRouter.get('/api/stars/:hip', (req, res) => {
  try {
    const hip = parseInt(req.params.hip, 10);
    if (isNaN(hip)) {
      res.status(400).json({ error: 'HIP invalide', code: 'INVALID_HIP' });
      return;
    }
    const star = getDeepStarByHip(hip);
    if (!star) {
      res.status(404).json({ error: 'Étoile introuvable', code: 'STAR_NOT_FOUND' });
      return;
    }
    res.json(star);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
