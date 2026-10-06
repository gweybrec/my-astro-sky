import type { StarSearchResult } from '../domain/stars';

/** The remote star search (SIMBAD through the backend). */
export type StarSearchFn = (query: string, limit?: number) => Promise<StarSearchResult[]>;

let remoteSearch: StarSearchFn = async () => [];

/** Called once at start-up by each platform. Default: no results. */
export function configureStarSearch(fn: StarSearchFn): void {
  remoteSearch = fn;
}

export function searchStarsRemote(query: string, limit?: number): Promise<StarSearchResult[]> {
  return remoteSearch(query, limit);
}
