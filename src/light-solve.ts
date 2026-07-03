import { detectStars } from './star-detector';
import { searchStarsByPosition } from './api';
import type { DetectedSpot } from './types';
import { t } from './i18n';
import { reportUnknownRendererError } from './error-reporter';

/**
 * Light plate solving: detect bright stars in image and suggest catalog matches
 * based on hint position. User can then quickly confirm matches instead of
 * manually clicking and searching for each star.
 */

export interface LightSolveCandidate {
  // Position in photo
  photoX: number;
  photoY: number;
  // Detected star properties
  intensity: number;
  rank: number; // 1 = brightest, 2 = second brightest, etc.
  // Suggested catalog matches (if hints provided)
  suggestedStars?: Array<{
    hip: number;
    name?: string;
    ra: number;
    dec: number;
    mag: number;
    distance: number; // angular distance from hint position in degrees
  }>;
}

export interface LightSolveResult {
  candidates: LightSolveCandidate[];
  message: string;
}

/**
 * Detect bright stars in image and optionally suggest catalog matches
 */
export async function lightSolve(
  imageData: ImageData,
  origWidth: number,
  origHeight: number,
  hints?: { ra: number; dec: number; radius?: number },
): Promise<LightSolveResult> {
  // Detect stars in image
  const detection = detectStars(imageData, origWidth, origHeight);

  if (detection.spots.length === 0) {
    return {
      candidates: [],
      message: t('lightSolve.noStarsDetected'),
    };
  }

  // Sort by brightness and take top 10
  const sortedSpots = [...detection.spots].sort((a, b) => b.brightness - a.brightness).slice(0, 10);

  const candidates: LightSolveCandidate[] = [];

  // If hints provided, search for nearby catalog stars
  if (hints?.ra !== undefined && hints?.dec !== undefined) {
    const searchRadius = hints.radius ?? 5;

    try {
      // Search for bright stars near hint position
      const catalogStars = await searchStarsByPosition({
        ra: hints.ra,
        dec: hints.dec,
        radius: searchRadius,
        magLimit: 12, // Only bright stars
        limit: 100,
      });

      // For each detected spot, find nearby catalog stars
      for (let i = 0; i < sortedSpots.length; i++) {
        const spot = sortedSpots[i];

        // Sort catalog stars by magnitude (brightest first)
        const sortedCatalog = catalogStars.sort((a, b) => a.mag - b.mag).slice(0, 5); // Top 5 candidates

        candidates.push({
          photoX: spot.x,
          photoY: spot.y,
          intensity: spot.brightness,
          rank: i + 1,
          suggestedStars: sortedCatalog.map((star) => ({
            hip: star.hip,
            name: star.name,
            ra: star.ra,
            dec: star.dec,
            mag: star.mag,
            distance: angularDistance(hints.ra, hints.dec, star.ra, star.dec),
          })),
        });
      }

      return {
        candidates,
        message: t('lightSolve.foundWithSuggestions', {
          count: candidates.length,
          catalogCount: catalogStars.length,
        }),
      };
    } catch (err) {
      reportUnknownRendererError('light_solve_catalog_search', err);
      // Fall back to detection only
    }
  }

  // No hints or search failed - just return detected spots
  for (let i = 0; i < sortedSpots.length; i++) {
    const spot = sortedSpots[i];
    candidates.push({
      photoX: spot.x,
      photoY: spot.y,
      intensity: spot.brightness,
      rank: i + 1,
    });
  }

  return {
    candidates,
    message: t('lightSolve.foundStars', { count: candidates.length }),
  };
}

/**
 * Calculate angular distance between two positions (in degrees)
 */
function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const ra1Rad = ra1 * toRad;
  const dec1Rad = dec1 * toRad;
  const ra2Rad = ra2 * toRad;
  const dec2Rad = dec2 * toRad;

  const dRa = ra2Rad - ra1Rad;
  const dDec = dec2Rad - dec1Rad;

  const a =
    Math.sin(dDec / 2) ** 2 + Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.sin(dRa / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));

  return c / toRad; // Convert back to degrees
}
