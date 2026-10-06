import fs from 'fs';
import path from 'path';
import type { GearCatalog } from '@myastrosky/core/domain/gear';
import { RESOURCES_DIR } from './server-paths.js';

/** Reads the four built-in equipment lists from `resources/`. */
export function loadBuiltInGearCatalog(): GearCatalog {
  const read = (file: string): object[] =>
    JSON.parse(fs.readFileSync(path.join(RESOURCES_DIR, file), 'utf-8'));
  return {
    telescopes: read('telescopes.json'),
    cameras: read('cameras.json'),
    accessories: read('accessories.json'),
    filters: read('filters.json'),
  };
}
