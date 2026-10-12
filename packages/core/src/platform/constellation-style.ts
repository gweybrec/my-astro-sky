import type { ConstellationStyle } from '../types';

/** Loads the lines of one constellation style (the platform fetches them). */
export type ConstellationStyleLoader = (style: ConstellationStyle) => Promise<void>;

let loader: ConstellationStyleLoader = async () => {};

/** Called once at start-up by each platform. Default: nothing is loaded. */
export function configureConstellationStyleLoader(load: ConstellationStyleLoader): void {
  loader = load;
}

export function loadConstellationStyle(style: ConstellationStyle): Promise<void> {
  return loader(style);
}
