import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Greek letter mapping for Latin input (alpha -> α, beta -> β, etc.)
const greekLetterMap: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω'
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

export interface DeepStar {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
}

export interface StarSearchResult {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  label: string;
  score: number;
}

let deepStars: DeepStar[] | null = null;
let starsByHip: Map<number, DeepStar> | null = null;

function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}

export function loadDeepCatalog(): void {
  if (deepStars) return;

  const publicDataDir = process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data');
  const deepPath = path.join(__dirname, 'data', 'stars.deep.json');
  const fallbackPath = path.join(publicDataDir, 'stars.8.json');
  const namesPath = path.join(publicDataDir, 'starnames.json');

  let catalogPath: string;
  if (fs.existsSync(deepPath)) {
    catalogPath = deepPath;
    console.log('Chargement du catalogue profond (stars.deep.json)…');
  } else {
    catalogPath = fallbackPath;
    console.log('Catalogue profond non trouvé, fallback sur stars.8.json');
  }

  const starsData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const namesData = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));

  deepStars = [];
  starsByHip = new Map();

  for (const f of starsData.features) {
    const mag: number = f.properties.mag;
    if (mag > 11) continue;

    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];

    const star: DeepStar = {
      hip,
      ra: normalizeRA(ra),
      dec,
      mag,
      bv: parseFloat(f.properties.bv) || 0,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      flam: info?.flam || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
    };

    deepStars.push(star);
    starsByHip.set(hip, star);
  }

  deepStars.sort((a, b) => a.mag - b.mag);
  console.log(`Catalogue chargé : ${deepStars.length} étoiles (mag ≤ 11)`);
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

export function searchDeepStars(query: string, limit = 10): StarSearchResult[] {
  loadDeepCatalog();
  if (!query || query.length < 1) return [];

  const normalized = normalizeGreekLetters(query);
  const q = normalized.toLowerCase().trim();

  // Direct HIP lookup
  const hipMatch = q.match(/^hip\s*(\d+)$/i) || q.match(/^(\d+)$/);
  if (hipMatch) {
    const hip = parseInt(hipMatch[1], 10);
    const star = starsByHip!.get(hip);
    if (star) {
      return [{ ...star, label: starLabel(star), score: 100 }];
    }
    return [];
  }

  const results: StarSearchResult[] = [];

  for (const star of deepStars!) {
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
      const full = star.constellation
        ? `${star.desig} ${star.constellation}`.toLowerCase()
        : d;

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
  return results.slice(0, limit);
}

export function getDeepStarByHip(hip: number): DeepStar | undefined {
  loadDeepCatalog();
  return starsByHip!.get(hip);
}

/**
 * Search stars by position (RA/Dec) within a given radius
 * @param ra Right Ascension in degrees
 * @param dec Declination in degrees
 * @param radius Search radius in degrees
 * @param magLimit Maximum magnitude (only return stars brighter than this)
 * @param limit Maximum number of results
 * @returns Array of stars within the radius, sorted by magnitude
 */
export function searchStarsByPosition(
  ra: number,
  dec: number,
  radius: number,
  magLimit: number = 10,
  limit: number = 20
): StarSearchResult[] {
  loadDeepCatalog();
  if (!deepStars) return [];

  const results: StarSearchResult[] = [];
  const radiusRad = radius * Math.PI / 180;
  const raRad = ra * Math.PI / 180;
  const decRad = dec * Math.PI / 180;

  // Calculate angular distance using haversine formula
  for (const star of deepStars) {
    if (star.mag > magLimit) continue;

    const starRaRad = star.ra * Math.PI / 180;
    const starDecRad = star.dec * Math.PI / 180;

    // Haversine formula for angular distance
    const dRa = starRaRad - raRad;
    const dDec = starDecRad - decRad;
    const a = Math.sin(dDec / 2) ** 2 + 
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
        label: starLabel(star),
        score: 0
      });
    }
  }

  // Sort by magnitude (brightest first) and limit results
  results.sort((a, b) => a.mag - b.mag);
  return results.slice(0, limit);
}
