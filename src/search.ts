import type { Star, DSO, DSOSearchResult } from './types';
import { getStars, getStarByHip } from './star-catalog';
import { getDSOs } from './dso-catalog';
import { searchStarsAPI } from './api';
import type { StarSearchResult } from './api';
import { t } from './i18n';

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

export interface SearchResult {
  star: Star;
  label: string;
  score: number;
}

function starLabel(star: Star): string {
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

export function searchStars(query: string, limit = 10): SearchResult[] {
  if (!query || query.length < 1) return [];

  const normalized = normalizeGreekLetters(query);
  const q = normalized.toLowerCase().trim();

  // Direct HIP lookup: "hip 12345" or "HIP12345" or pure number
  const hipMatch = q.match(/^hip\s*(\d+)$/i) || q.match(/^(\d+)$/);
  if (hipMatch) {
    const hip = parseInt(hipMatch[1], 10);
    const star = getStarByHip(hip);
    if (star) {
      return [{ star, label: starLabel(star), score: 100 }];
    }
    return [];
  }

  const results: SearchResult[] = [];

  for (const star of getStars()) {
    let score = 0;
    let label = '';

    // Match by proper name
    if (star.name) {
      const n = star.name.toLowerCase();
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by Bayer designation
    if (score === 0 && star.desig) {
      const d = star.desig.toLowerCase();
      const full = star.constellation
        ? `${star.desig} ${star.constellation}`.toLowerCase()
        : d;

      if (full.startsWith(q) || d.startsWith(q)) score = 50;
      else if (full.includes(q) || d.includes(q)) score = 30;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by Flamsteed designation (e.g. "47 UMa")
    if (score === 0 && star.flam && star.constellation) {
      const flamFull = `${star.flam} ${star.constellation}`.toLowerCase();
      if (flamFull.startsWith(q)) score = 45;
      else if (flamFull.includes(q)) score = 25;

      if (score > 0) {
        label = starLabel(star);
      }
    }

    // Match by constellation
    if (score === 0 && star.constellation) {
      if (star.constellation.toLowerCase().startsWith(q)) {
        score = 20;
        label = starLabel(star);
      }
    }

    if (score > 0) {
      // Boost brighter stars
      score += Math.max(0, (6 - star.mag) * 2);
      results.push({ star, label, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function getDSOTypeName(type: string): string {
  return t(`dso.types.${type}`) || t('dso.object');
}

function dsoLabel(dso: DSO): string {
  const typeName = getDSOTypeName(dso.type);
  // Drop internal "LPN-xxx" ids from cross refs (consistent with the tooltip/info panel)
  const crossRefList = dso.catalogs.slice(1).filter(c => !c.startsWith('LPN-'));
  const crossRefs = crossRefList.length ? ` (${crossRefList.join(' · ')})` : '';
  if (dso.id.startsWith('LPN-')) {
    // For LPN objects, show displayName or stripped id (no "LPN-xxx" prefix in label)
    const name = dso.displayName || dso.id.replace(/^LPN-/, '');
    return `${name}${crossRefs || ` (${typeName})`}`;
  }
  if (dso.displayName) {
    // When the display name is just the spaced-out id (e.g. id "Abell24",
    // name "Abell 24"), don't repeat it — show the nicer spaced name alone.
    if (normCatId(dso.id) === normCatId(dso.displayName)) {
      return `${dso.displayName}${crossRefs}`;
    }
    return `${dso.id} – ${dso.displayName}${crossRefs}`;
  }
  return `${dso.id}${crossRefs || ` (${typeName})`}`;
}

/**
 * Normalize a catalog designation for matching by dropping whitespace and dots.
 * Catalog ids carry no internal spaces, and some aliases store the component
 * separator inconsistently — e.g. the canonical "PK 217+14.1" is stored as
 * "PK 217+14  1". Collapsing both to "pk217+141" lets either form match.
 */
function normCatId(s: string): string {
  return s.toLowerCase().replace(/[\s.]+/g, '');
}

export function searchDSOs(query: string, limit = 10): DSOSearchResult[] {
  if (!query || query.length < 1) return [];

  const normalized = normalizeGreekLetters(query);
  const q = normalized.toLowerCase().trim();
  // Match catalog ids space- and dot-insensitively: "barnard 33", "ngc 1976",
  // "m 42" and "PK 217+14.1" resolve like "barnard33", "pk217+141", etc.
  const qId = normCatId(q);
  const results: DSOSearchResult[] = [];

  for (const dso of getDSOs()) {
    let score = 0;
    const idLower = dso.id.toLowerCase();
    const nameLower = dso.displayName ? dso.displayName.toLowerCase() : '';
    // Check all catalog aliases (e.g. NGC1976 and LBN974 both find M42, and
    // Barnard33 finds IC434). Distinguish exact from prefix: an exact alias is
    // the precise designation the user typed and must rank with an exact id.
    const catsLower = dso.catalogs.map(c => normCatId(c));
    const aliasExact = catsLower.some(c => c === qId);
    const aliasPrefix = catsLower.some(c => c.startsWith(qId));

    // 1. Exact match on the primary id OR any catalog alias (the exact thing typed).
    //    e.g. "barnard33" → IC434 must beat "barnard330" (a mere id prefix).
    if (idLower === qId || aliasExact) {
      score = 100;
    }
    // 2. ID prefix match
    else if (idLower.startsWith(qId)) {
      score = 90;
    }
    // 3. Exact name match
    else if (nameLower && nameLower === q) {
      score = 80;
    }
    // 4. Name starts with query
    else if (nameLower && nameLower.startsWith(q)) {
      score = 70;
    }
    // 5. Alias prefix match (e.g. "ngc19" → NGC1976, alias of M42)
    else if (aliasPrefix) {
      score = 60;
    }
    // 6. Name contains query
    else if (nameLower && nameLower.includes(q)) {
      score = 40;
    }
    // 7. Partial ID match (e.g. "ngc70" matches "NGC7000")
    else if (idLower.includes(qId)) {
      score = 30;
    }

    if (score > 0) {
      // Brightness boost — capped below the 10-point tier gap so an exact match
      // always outranks a prefix match regardless of object brightness.
      const mag = dso.mag ?? 14;
      score += Math.min(9, Math.max(0, (10 - mag) * 1.5));
      results.push({ dso, label: dsoLabel(dso), score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export interface UnifiedSearchResult {
  type: 'star' | 'dso';
  label: string;
  score: number;
  mag: number;
  ra: number;
  dec: number;
  star?: StarSearchResult;
  dso?: DSO;
}

export async function searchUnified(query: string, limit = 15): Promise<UnifiedSearchResult[]> {
  if (!query || query.length < 1) return [];

  const [starResults, dsoResults] = await Promise.all([
    searchStarsAPI(query, 8),
    Promise.resolve(searchDSOs(query, 8)),
  ]);

  const results: UnifiedSearchResult[] = [];

  for (const s of starResults) {
    results.push({
      type: 'star',
      label: s.label,
      score: s.score,
      mag: s.mag,
      ra: s.ra,
      dec: s.dec,
      star: s,
    });
  }

  for (const d of dsoResults) {
    results.push({
      type: 'dso',
      label: d.label,
      score: d.score,
      mag: d.dso.mag ?? 99,
      ra: d.dso.ra,
      dec: d.dso.dec,
      dso: d.dso,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
