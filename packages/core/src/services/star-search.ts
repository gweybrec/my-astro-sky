/**
 * Star search over the deep catalogue: by name or designation, by position, and by HIP number.
 * The catalogue is read by the host (a file on the server, the bundled data on the phone) and
 * passed in; the service only scores and labels.
 */
import { DomainError } from '../domain/errors';
import type { DeepStar, NearbyStarsQuery, StarSearchResult } from '../domain/stars';

/** The stars, sorted by magnitude (brightest first), or a function that returns them. */
export type StarCatalogSource =
  readonly DeepStar[] | (() => readonly DeepStar[] | Promise<readonly DeepStar[]>);

export interface StarSearchServiceDeps {
  stars: StarCatalogSource;
}

export interface StarSearchService {
  /** Stars matching a name, designation or HIP number, best first. `limit` is clamped to 1..50 (default 10). */
  search(query: string, limit?: number): Promise<StarSearchResult[]>;
  /** Stars within `radius` degrees of a position, brightest first. `limit` is clamped to 1..100 (default 20). */
  nearby(query: NearbyStarsQuery): Promise<StarSearchResult[]>;
  /** One star by HIP number. Throws `invalid` (INVALID_HIP) for a non-integer, `notFound` (STAR_NOT_FOUND) if absent. */
  getByHip(hip: number): Promise<DeepStar>;
}

// Greek letter mapping for Latin input (alpha -> α, beta -> β, etc.)
const greekLetterMap: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
};

/**
 * Normalize a search query by replacing Latin Greek letter names with Greek characters.
 * E.g., "alpha ori" -> "α ori", "beta per" -> "β per"
 */
function normalizeGreekLetters(query: string): string {
  let normalized = query;
  for (const [latin, greek] of Object.entries(greekLetterMap)) {
    // Match whole word boundaries to avoid partial replacements
    const regex = new RegExp(`\\b${latin}\\b`, 'gi');
    normalized = normalized.replace(regex, greek);
  }
  return normalized;
}

function starLabel(star: DeepStar): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.desig && star.constellation) {
    return `${star.desig} ${star.constellation}`;
  }
  if (star.flam && star.constellation) {
    return `${star.flam} ${star.constellation}`;
  }
  return `HIP ${star.hip} (${star.constellation || '?'}, mag ${star.mag.toFixed(1)})`;
}

/** Clamps a requested result count to 1..max; anything that is not a usable number gives the default. */
function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  const n =
    typeof limit === 'number' && Number.isFinite(limit) ? Math.trunc(limit) || fallback : fallback;
  return Math.min(Math.max(1, n), max);
}

export function createStarSearchService(deps: StarSearchServiceDeps): StarSearchService {
  let loaded: Promise<{ stars: readonly DeepStar[]; byHip: Map<number, DeepStar> }> | null = null;

  /** Loads and indexes the catalogue once, even when several calls arrive together. */
  function catalog() {
    loaded ??= Promise.resolve(typeof deps.stars === 'function' ? deps.stars() : deps.stars).then(
      (stars) => ({ stars, byHip: new Map(stars.map((s) => [s.hip, s])) }),
    );
    return loaded;
  }

  return {
    async search(query, limit = 10) {
      const { stars, byHip } = await catalog();
      const max = clampLimit(limit, 10, 50);
      if (typeof query !== 'string' || query.length < 1) return [];

      const q = normalizeGreekLetters(query).toLowerCase().trim();

      // Direct HIP lookup
      const hipMatch = q.match(/^hip\s*(\d+)$/i) || q.match(/^(\d+)$/);
      if (hipMatch) {
        const star = byHip.get(parseInt(hipMatch[1], 10));
        return star ? [{ ...star, label: starLabel(star), score: 100 }] : [];
      }

      const results: StarSearchResult[] = [];
      for (const star of stars) {
        let score = 0;

        // Match by proper name
        if (star.name) {
          const n = star.name.toLowerCase();
          if (n === q) score = 100;
          else if (n.startsWith(q)) score = 80;
          else if (n.includes(q)) score = 60;
        }

        // Match by Bayer designation
        if (score === 0 && star.desig) {
          const d = star.desig.toLowerCase();
          const full = star.constellation ? `${star.desig} ${star.constellation}`.toLowerCase() : d;

          if (full.startsWith(q) || d.startsWith(q)) score = 50;
          else if (full.includes(q) || d.includes(q)) score = 30;
        }

        // Match by Flamsteed designation
        if (score === 0 && star.flam && star.constellation) {
          const flamFull = `${star.flam} ${star.constellation}`.toLowerCase();
          if (flamFull.startsWith(q)) score = 45;
          else if (flamFull.includes(q)) score = 25;
        }

        // Match by constellation
        if (score === 0 && star.constellation) {
          if (star.constellation.toLowerCase().startsWith(q)) {
            score = 20;
          }
        }

        if (score > 0) {
          // Boost brighter stars
          score += Math.max(0, (6 - star.mag) * 2);
          results.push({ ...star, label: starLabel(star), score });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, max);
    },

    async nearby(query) {
      const { stars } = await catalog();
      const { ra, dec, radius } = query;
      const magLimit = query.magLimit ?? 10;
      const max = clampLimit(query.limit, 20, 100);

      const results: StarSearchResult[] = [];
      const radiusRad = (radius * Math.PI) / 180;
      const raRad = (ra * Math.PI) / 180;
      const decRad = (dec * Math.PI) / 180;

      for (const star of stars) {
        if (star.mag > magLimit) continue;

        const starRaRad = (star.ra * Math.PI) / 180;
        const starDecRad = (star.dec * Math.PI) / 180;

        // Haversine formula for angular distance
        const dRa = starRaRad - raRad;
        const dDec = starDecRad - decRad;
        const a =
          Math.sin(dDec / 2) ** 2 +
          Math.cos(decRad) * Math.cos(starDecRad) * Math.sin(dRa / 2) ** 2;
        const angularDistance = 2 * Math.asin(Math.sqrt(a));

        if (angularDistance <= radiusRad) {
          results.push({
            hip: star.hip,
            ra: star.ra,
            dec: star.dec,
            mag: star.mag,
            bv: star.bv,
            name: star.name,
            bayer: star.bayer,
            flam: star.flam,
            constellation: star.constellation,
            desig: star.desig,
            multiplicity: star.multiplicity,
            label: starLabel(star),
            score: 0,
          });
        }
      }

      // Brightest first
      results.sort((a, b) => a.mag - b.mag);
      return results.slice(0, max);
    },

    async getByHip(hip) {
      const { byHip } = await catalog();
      if (typeof hip !== 'number' || !Number.isInteger(hip)) {
        throw new DomainError('invalid', 'HIP invalide', {
          code: 'INVALID_HIP',
          body: { error: 'HIP invalide', code: 'INVALID_HIP' },
        });
      }
      const star = byHip.get(hip);
      if (!star) {
        throw new DomainError('notFound', 'Étoile introuvable', {
          code: 'STAR_NOT_FOUND',
          body: { error: 'Étoile introuvable', code: 'STAR_NOT_FOUND' },
        });
      }
      return star;
    },
  };
}
