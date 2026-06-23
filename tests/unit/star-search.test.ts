import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// star-search.ts loads its catalog from disk on first use and caches it at module
// scope. To exercise the catalog-resolution branches we point it at small fixture
// files via STAR_CATALOG_PATH / PUBLIC_DATA_DIR, then re-import the module fresh
// (vi.resetModules) for each scenario so loadDeepCatalog() runs again.

interface Feature {
  type: 'Feature';
  id: number;
  properties: { mag: number; bv: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

function feature(id: number, ra: number, dec: number, mag: number, bv = '0.0'): Feature {
  return {
    type: 'Feature',
    id,
    properties: { mag, bv },
    geometry: { type: 'Point', coordinates: [ra, dec] },
  };
}

function writeCatalog(file: string, features: Feature[]): void {
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
}

let tmpDir: string;
let primaryPath: string;

// HIP ids used across the fixtures
const VEGA = 91262; // bright, named
const FAINT = 90001; // mag 12.5 -> excluded by the mag<=11 cap
const NEIGHBOUR = 91300; // near Vega, for position search
const FAR = 10000; // far from Vega

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-search-'));

  primaryPath = path.join(tmpDir, 'stars.14.json');

  writeCatalog(primaryPath, [
    feature(VEGA, 279.2347, 38.7837, 0.03),
    feature(NEIGHBOUR, 279.5, 38.9, 4.2),
    feature(FAR, 24.4285, -57.2368, 1.1),
    feature(FAINT, 280.0, 39.0, 12.5),
  ]);

  // Star name metadata keyed by HIP id (matches public/data/starnames.json shape)
  fs.writeFileSync(
    path.join(tmpDir, 'starnames.json'),
    JSON.stringify({
      [VEGA]: { name: 'Vega', bayer: 'α', flam: '3', c: 'Lyr', desig: 'α' },
      [NEIGHBOUR]: { name: '', bayer: 'ε', flam: '', c: 'Lyr', desig: 'ε' },
    }),
  );
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.STAR_CATALOG_PATH;
  delete process.env.PUBLIC_DATA_DIR;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Import a fresh copy of star-search with the given env applied. */
async function loadModule(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return import('../../server/star-search.js');
}

describe('catalog resolution', () => {
  it('uses STAR_CATALOG_PATH when set', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(mod.getDeepStarByHip(VEGA)?.name).toBe('Vega');
  });

  it('defaults to stars.14.json under PUBLIC_DATA_DIR when STAR_CATALOG_PATH is unset', async () => {
    // tmpDir contains stars.14.json (written as primaryPath), so the default resolves to it.
    const mod = await loadModule({ PUBLIC_DATA_DIR: tmpDir });
    expect(mod.getDeepStarByHip(VEGA)?.name).toBe('Vega');
  });

  it('excludes stars fainter than magnitude 11', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(mod.getDeepStarByHip(FAINT)).toBeUndefined();
  });
});

describe('searchDeepStars', () => {
  it('resolves a direct HIP lookup with a perfect score', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });

    const byNumber = mod.searchDeepStars('91262');
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].hip).toBe(VEGA);
    expect(byNumber[0].score).toBe(100);

    expect(mod.searchDeepStars('HIP 91262')[0].hip).toBe(VEGA);
    expect(mod.searchDeepStars('99999999')).toEqual([]);
  });

  it('matches by proper name and labels the result', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });

    const res = mod.searchDeepStars('vega');
    expect(res[0].hip).toBe(VEGA);
    expect(res[0].label).toBe('Vega (α Lyr)');
  });

  it('normalizes Latin Greek letter names before matching designations', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });

    // "epsilon lyr" -> "ε lyr" should hit the unnamed ε Lyr neighbour.
    const res = mod.searchDeepStars('epsilon lyr');
    expect(res.some((r) => r.hip === NEIGHBOUR)).toBe(true);
  });

  it('returns an empty array for an empty query', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(mod.searchDeepStars('')).toEqual([]);
  });

  it('honours the result limit', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    // "lyr" matches both Lyra stars; cap to 1.
    expect(mod.searchDeepStars('lyr', 1)).toHaveLength(1);
  });
});

describe('searchStarsByPosition', () => {
  it('returns stars within the radius sorted brightest-first', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });

    // 2° around Vega: includes Vega (mag 0.03) and the ε Lyr neighbour, excludes FAR.
    const res = mod.searchStarsByPosition(279.2347, 38.7837, 2);
    const hips = res.map((r) => r.hip);
    expect(hips).toContain(VEGA);
    expect(hips).toContain(NEIGHBOUR);
    expect(hips).not.toContain(FAR);
    // sorted by magnitude ascending
    expect(res[0].hip).toBe(VEGA);
    expect(res.map((r) => r.mag)).toEqual([...res.map((r) => r.mag)].sort((a, b) => a - b));
  });

  it('respects the magnitude limit', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });

    // magLimit 1 keeps Vega (0.03) but drops the ε Lyr neighbour (4.2).
    const res = mod.searchStarsByPosition(279.2347, 38.7837, 2, 1);
    expect(res.map((r) => r.hip)).toEqual([VEGA]);
  });

  it('returns nothing when no star falls inside the radius', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(mod.searchStarsByPosition(0, 0, 0.5)).toEqual([]);
  });
});
