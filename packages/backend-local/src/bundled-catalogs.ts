/**
 * The catalogues the app ships (the star files under `data/`, the four built-in gear lists under `gear/`),
 * loaded through `fetch` from the app's own address. Each file is fetched and parsed once, on first use, and
 * kept; the two star lists are built from one parse of the three star files.
 */
import {
  buildCatalogStars,
  buildDeepStars,
  type StarMultiplesJson,
  type StarNamesJson,
  type StarsJson,
} from '@myastrosky/core/catalog/star-lists';
import type { DeepStar } from '@myastrosky/core/domain/stars';
import type { GearCatalog } from '@myastrosky/core/domain/gear';
import type { CatalogStar } from '@myastrosky/core/wcs';

export interface BundledCatalogsOptions {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** The app's address, without a trailing slash (`''` for relative addresses). */
  baseUrl: string;
}

export interface BundledCatalogs {
  /** The deep star catalogue (magnitude 11 and brighter), brightest first. */
  stars: () => Promise<readonly DeepStar[]>;
  /** The catalogue that solved files are matched against, brightest first. */
  catalogStars: () => Promise<readonly CatalogStar[]>;
  /** The four built-in equipment lists. */
  gearCatalog: () => Promise<GearCatalog>;
}

export function createBundledCatalogs(options: BundledCatalogsOptions): BundledCatalogs {
  const base = options.baseUrl.replace(/\/+$/, '');

  const load = async (path: string): Promise<unknown> => {
    const res = await options.fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`Could not load ${path}: status ${res.status}`);
    return res.json();
  };
  /** A file that may be absent: the phone's local server answers an unknown path with a page that is not JSON. */
  const loadOptional = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return (await load(path)) as T;
    } catch {
      return fallback;
    }
  };

  /** Runs `fn` on first use and keeps the result; a failure is not kept, so a later call tries again. */
  const lazy = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
    let pending: Promise<T> | null = null;
    return () => {
      pending ??= fn().catch((err) => {
        pending = null;
        throw err;
      });
      return pending;
    };
  };

  const starFiles = lazy(async () => {
    const [starsJson, namesJson, multiplesJson] = await Promise.all([
      load('data/stars.14.json') as Promise<StarsJson>,
      load('data/starnames.json') as Promise<StarNamesJson>,
      loadOptional<StarMultiplesJson>('data/star-multiples.json', {}),
    ]);
    return { starsJson, namesJson, multiplesJson };
  });

  return {
    stars: lazy(async () => {
      const f = await starFiles();
      return buildDeepStars(f.starsJson, f.namesJson, f.multiplesJson);
    }),
    catalogStars: lazy(async () => {
      const f = await starFiles();
      return buildCatalogStars(f.starsJson, f.namesJson);
    }),
    gearCatalog: lazy(async () => {
      const [telescopes, cameras, accessories, filters] = await Promise.all(
        ['telescopes', 'cameras', 'accessories', 'filters'].map(
          (n) => load(`gear/${n}.json`) as Promise<object[]>,
        ),
      );
      return { telescopes, cameras, accessories, filters };
    }),
  };
}
