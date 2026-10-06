import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import { horizon } from '../services.js';
import { sendError } from './http-errors.js';
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
  const radiusKm = Number(req.query.radiusKm);
  try {
    const profile = await horizon.getProfile({
      lat: Number(req.query.lat),
      lon: Number(req.query.lon),
      radiusKm: Number.isFinite(radiusKm) ? radiusKm : 40,
      obsHeightM:
        req.query.obsHeightM !== undefined && Number.isFinite(Number(req.query.obsHeightM))
          ? Number(req.query.obsHeightM)
          : null,
    });
    res.json(profile);
  } catch (err) {
    // The compute failure carries the original error as its cause, which is what the log wants.
    if (isDomainError(err) && err.code === 'HORIZON_COMPUTE_FAILED') {
      logServerError('horizon_compute_failed', err.cause ?? err);
    }
    sendError(res, err);
  }
});
