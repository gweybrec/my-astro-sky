import express from 'express';
import { horizonCacheKey, getCachedHorizon, setCachedHorizon } from '../db.js';
import { computeHorizon } from '../horizon.js';
import { logServerError } from '../logger.js';

export const horizonRouter = express.Router();

/**
 * @swagger
 * /api/horizon:
 *   get:
 *     summary: Compute (or return cached) terrain horizon profile for a location
 *     description: >
 *       Ray-traces open DEM elevation tiles around the given latitude/longitude to
 *       produce the observer's real skyline — horizon altitude (degrees) sampled once
 *       per degree of azimuth (0 = North, clockwise). Also returns a best-effort
 *       `summits` array of named peaks (from OpenStreetMap) sitting on that skyline.
 *       Cached by rounded location.
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: lon
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: radiusKm
 *         schema: { type: number, default: 40 }
 *       - in: query
 *         name: obsHeightM
 *         description: Eye height above local ground in metres (default 1.7).
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Horizon profile returned
 *       400:
 *         description: Invalid or missing lat/lon
 *       502:
 *         description: Failed to fetch or process elevation data
 */
horizonRouter.get('/api/horizon', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
    res.status(400).json({ error: 'Invalid or missing lat/lon' });
    return;
  }
  const radiusKm = Number.isFinite(Number(req.query.radiusKm)) ? Number(req.query.radiusKm) : 40;
  const obsHeightM =
    req.query.obsHeightM !== undefined && Number.isFinite(Number(req.query.obsHeightM))
      ? Number(req.query.obsHeightM)
      : null;

  const key = horizonCacheKey(lat, lon, radiusKm, obsHeightM);
  const cached = getCachedHorizon(key);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const profile = await computeHorizon(lat, lon, { radiusKm, obsHeightM });
    setCachedHorizon(key, profile);
    res.json(profile);
  } catch (err) {
    logServerError('horizon_compute_failed', err);
    res.status(502).json({ error: 'Failed to compute horizon from elevation data' });
  }
});
