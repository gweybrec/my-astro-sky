import express from 'express';
import { skybotConesearch } from '../skybot.js';
import { tnsConesearch, TnsRateLimitError } from '../tns.js';
import { fetchCometElements } from '../comets.js';
import { msg } from '../messages.js';
import type { ServerLang } from '../messages.js';
import { logServerError } from '../logger.js';

export const identifyRouter = express.Router();

/**
 * @swagger
 * /api/skybot/conesearch:
 *   post:
 *     summary: Cone-search IMCCE SkyBoT for known asteroids near a sky position and epoch
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               raDeg:
 *                 type: number
 *               decDeg:
 *                 type: number
 *               radiusArcmin:
 *                 type: number
 *               epochJd:
 *                 type: number
 *     responses:
 *       200:
 *         description: Candidate asteroids returned successfully
 *       400:
 *         description: Invalid search parameters
 *       502:
 *         description: SkyBoT upstream request failed
 */
// --- SkyBoT asteroid cone search (used by the asteroid-identification modal) ---
identifyRouter.post('/api/skybot/conesearch', async (req, res) => {
  const lang: ServerLang = req.body.lang === 'fr' ? 'fr' : 'en';
  try {
    const raDeg = Number(req.body.raDeg);
    const decDeg = Number(req.body.decDeg);
    const radiusArcmin = Number(req.body.radiusArcmin);
    const epochJd = Number(req.body.epochJd);

    if (
      !Number.isFinite(raDeg) ||
      raDeg < 0 ||
      raDeg > 360 ||
      !Number.isFinite(decDeg) ||
      decDeg < -90 ||
      decDeg > 90 ||
      !Number.isFinite(radiusArcmin) ||
      radiusArcmin <= 0 ||
      radiusArcmin > 60 ||
      !Number.isFinite(epochJd) ||
      epochJd <= 0
    ) {
      res.status(400).json({ error: msg.api.invalidSkybotParams(lang), code: 'INVALID_PARAMS' });
      return;
    }

    const candidates = await skybotConesearch({ raDeg, decDeg, radiusArcmin, epochJd });
    res.json({ candidates });
  } catch (err) {
    logServerError('skybot_conesearch_failed', err);
    res.status(502).json({ error: msg.api.skybotError(lang, (err as Error).message) });
  }
});

/**
 * @swagger
 * /api/tns/conesearch:
 *   post:
 *     summary: Cone-search the IAU Transient Name Server for supernovae discovered in a date window
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               raDeg:
 *                 type: number
 *               decDeg:
 *                 type: number
 *               radiusArcmin:
 *                 type: number
 *               dateStart:
 *                 type: string
 *                 description: Earliest discovery date (YYYY-MM-DD)
 *               dateEnd:
 *                 type: string
 *                 description: Latest discovery date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Candidate transients returned successfully
 *       400:
 *         description: Invalid search parameters
 *       429:
 *         description: TNS rate limit reached (anonymous cone search allows ~2 queries per minute)
 *       502:
 *         description: TNS upstream request failed
 */
// --- TNS supernova cone search (used by the supernova-identification modal) ---
identifyRouter.post('/api/tns/conesearch', async (req, res) => {
  const lang: ServerLang = req.body.lang === 'fr' ? 'fr' : 'en';
  try {
    const raDeg = Number(req.body.raDeg);
    const decDeg = Number(req.body.decDeg);
    const radiusArcmin = Number(req.body.radiusArcmin);
    const dateStart = String(req.body.dateStart ?? '');
    const dateEnd = String(req.body.dateEnd ?? '');
    const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

    if (
      !Number.isFinite(raDeg) ||
      raDeg < 0 ||
      raDeg > 360 ||
      !Number.isFinite(decDeg) ||
      decDeg < -90 ||
      decDeg > 90 ||
      !Number.isFinite(radiusArcmin) ||
      radiusArcmin <= 0 ||
      radiusArcmin > 60 ||
      !isDay(dateStart) ||
      !isDay(dateEnd) ||
      dateStart > dateEnd
    ) {
      res.status(400).json({ error: msg.api.invalidTnsParams(lang), code: 'INVALID_PARAMS' });
      return;
    }

    const candidates = await tnsConesearch({ raDeg, decDeg, radiusArcmin, dateStart, dateEnd });
    res.json({ candidates });
  } catch (err) {
    if (err instanceof TnsRateLimitError) {
      res.status(429).json({
        error: msg.api.tnsRateLimited(lang, err.retryAfterSeconds),
        code: 'RATE_LIMITED',
      });
      return;
    }
    logServerError('tns_conesearch_failed', err);
    res.status(502).json({ error: msg.api.tnsError(lang, (err as Error).message) });
  }
});

/**
 * @swagger
 * /api/comets/elements:
 *   get:
 *     summary: Current comet orbital elements from the Minor Planet Center
 *     description: Cached for 24 h server-side. The client propagates them to a photo's observation date to identify comets in its field.
 *     parameters:
 *       - in: query
 *         name: lang
 *         required: false
 *         schema:
 *           type: string
 *           enum: [fr, en]
 *         description: Language of the error message
 *     responses:
 *       200:
 *         description: Comet elements returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       designation:
 *                         type: string
 *                         example: C/2025 R2
 *                       name:
 *                         type: string
 *                         example: C/2025 R2 (SWAN)
 *                       tpJd:
 *                         type: number
 *                         description: Perihelion time (Julian Date, TT)
 *                       q:
 *                         type: number
 *                         description: Perihelion distance (AU)
 *                       e:
 *                         type: number
 *                         description: Eccentricity
 *                       peri:
 *                         type: number
 *                         description: Argument of perihelion (deg, J2000 ecliptic)
 *                       node:
 *                         type: number
 *                         description: Longitude of the ascending node (deg, J2000 ecliptic)
 *                       incl:
 *                         type: number
 *                         description: Inclination (deg, J2000 ecliptic)
 *                       h:
 *                         type: number
 *                         nullable: true
 *                         description: Absolute total magnitude (M1)
 *                       k:
 *                         type: number
 *                         nullable: true
 *                         description: Magnitude slope parameter (K1)
 *       502:
 *         description: The MPC could not be reached and nothing is cached
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
// --- MPC comet elements (used by the comet-identification modal) ---
identifyRouter.get('/api/comets/elements', async (req, res) => {
  const lang: ServerLang = req.query.lang === 'fr' ? 'fr' : 'en';
  try {
    const comets = await fetchCometElements();
    res.json({ comets });
  } catch (err) {
    logServerError('comet_elements_failed', err);
    res.status(502).json({ error: msg.api.cometElementsError(lang, (err as Error).message) });
  }
});
