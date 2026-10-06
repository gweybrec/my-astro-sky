// @vitest-environment node
/** The phone's catalogue loader, with a `fetch` that reads the repository's files: lists equal the server's. */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createBundledCatalogs } from '@myastrosky/backend-local/bundled-catalogs';
import { buildCatalogStars, buildDeepStars } from '@myastrosky/core/catalog/star-lists';
import { loadBuiltInGearCatalog } from '../../server/gear-catalog';
import { loadDeepCatalog } from '../../server/star-search';
import { loadServerCatalog } from '../../server/wcs-reader';

const ROOT = path.resolve(__dirname, '../..');

function setup(missing: string[] = []) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const rel = url.replace('http://app.test/', '');
    if (missing.includes(rel)) {
      // The phone's local server answers 200 with the app page for an unknown path.
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      };
    }
    const file = rel.startsWith('gear/')
      ? path.join(ROOT, 'resources', rel.slice(5))
      : path.join(ROOT, 'public', rel);
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown };
  };
  return { calls, catalogs: createBundledCatalogs({ fetch, baseUrl: 'http://app.test/' }) };
}

describe('createBundledCatalogs', () => {
  it('builds the same two star lists as the server', async () => {
    const { catalogs } = setup();
    const deep = await catalogs.stars();
    const server = loadDeepCatalog();
    expect(deep.length).toBe(server.length);
    expect(deep.slice(0, 50)).toEqual(server.slice(0, 50));
    const catalog = await catalogs.catalogStars();
    const serverCatalog = loadServerCatalog();
    expect(catalog.length).toBe(serverCatalog.length);
    expect(catalog.slice(0, 50)).toEqual(serverCatalog.slice(0, 50));
  }, 60_000);

  it('fetches each star file once for both lists, and each list once', async () => {
    const { catalogs, calls } = setup();
    await Promise.all([catalogs.stars(), catalogs.catalogStars()]);
    await catalogs.stars();
    await catalogs.catalogStars();
    expect([...calls].sort()).toEqual(
      [
        'http://app.test/data/star-multiples.json',
        'http://app.test/data/stars.14.json',
        'http://app.test/data/starnames.json',
      ].sort(),
    );
  }, 60_000);

  it('works without the optional multiples file', async () => {
    const { catalogs } = setup(['data/star-multiples.json']);
    expect((await catalogs.stars()).length).toBeGreaterThan(1000);
  }, 60_000);

  it('loads the four gear lists, equal to the server’s, once', async () => {
    const { catalogs, calls } = setup();
    expect(await catalogs.gearCatalog()).toEqual(loadBuiltInGearCatalog());
    await catalogs.gearCatalog();
    expect(calls).toHaveLength(4);
  });

  it('keeps the pure builders in step with the server loaders on a tiny catalogue', () => {
    const stars = {
      features: [
        {
          id: 1,
          properties: { mag: 5, bv: '0.5' },
          geometry: { coordinates: [-10, 20] as [number, number] },
        },
        { id: 2, properties: { mag: 12 }, geometry: { coordinates: [30, 40] as [number, number] } },
      ],
    };
    const deep = buildDeepStars(
      stars,
      { '1': { name: 'A' } },
      { '1': { components: 2, members: [2] } },
    );
    expect(deep).toHaveLength(1); // magnitude above 11 is left out
    expect(deep[0]).toMatchObject({
      hip: 1,
      ra: 350,
      name: 'A',
      bv: 0.5,
      multiplicity: { components: 2 },
    });
    expect(buildCatalogStars(stars).map((s) => s.hip)).toEqual([1, 2]);
  });
});
