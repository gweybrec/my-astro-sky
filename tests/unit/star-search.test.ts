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

function byHip(mod: { loadDeepCatalog(): { hip: number; name?: string }[] }, hip: number) {
  return mod.loadDeepCatalog().find((s) => s.hip === hip);
}

describe('catalog resolution', () => {
  it('uses STAR_CATALOG_PATH when set', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(byHip(mod, VEGA)?.name).toBe('Vega');
  });

  it('defaults to stars.14.json under PUBLIC_DATA_DIR when STAR_CATALOG_PATH is unset', async () => {
    // tmpDir contains stars.14.json (written as primaryPath), so the default resolves to it.
    const mod = await loadModule({ PUBLIC_DATA_DIR: tmpDir });
    expect(byHip(mod, VEGA)?.name).toBe('Vega');
  });

  it('excludes stars fainter than magnitude 11', async () => {
    const mod = await loadModule({ STAR_CATALOG_PATH: primaryPath, PUBLIC_DATA_DIR: tmpDir });
    expect(byHip(mod, FAINT)).toBeUndefined();
  });
});
