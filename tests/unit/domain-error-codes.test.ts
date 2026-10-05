// @vitest-environment node
/**
 * Every `DomainError` a service method rejects with carries a non-empty, upper-snake-case `code`
 * (WP2.6a). The paths driven here are the rejection paths of the service tests.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createGearService } from '@myastrosky/core/services/gear';
import { createPoiCategoryService } from '@myastrosky/core/services/poi-categories';
import { createSettingsService } from '@myastrosky/core/services/settings';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

describe('DomainError codes', () => {
  let conn: Database.Database;
  let paths: Record<string, () => Promise<unknown>>;

  beforeEach(async () => {
    conn = new Database(':memory:');
    const db = createBetterSqliteDb(conn);
    await initSchema(db);
    const newId = (): string => 'id';
    const dso = createDsoOverrideService({ db });
    const regions = createSkyRegionService({ db, newId });
    const poi = createPoiCategoryService({ db, newId });
    const gear = createGearService({
      db,
      newId,
      catalog: { telescopes: [], cameras: [], accessories: [], filters: [] },
    });
    const settings = createSettingsService({
      db,
      secrets: {
        canEncrypt: () => false,
        encrypt: async (s) => s,
        decrypt: async (s) => s,
        isEncrypted: () => false,
      },
      env: (k) => (k === 'ASTROMETRY_API_KEY' ? 'from-env' : undefined),
    });
    paths = {
      'dso.upsert id': () => dso.upsert('', {}),
      'dso.upsert data': () => dso.upsert('a', null),
      'dso.upsert ra': () => dso.upsert('a', { ra: 400 }),
      'dso.upsert dec': () => dso.upsert('a', { dec: 100 }),
      'regions.create name': () => regions.create({}),
      'regions.create points': () => regions.create({ name: 'n', points: [] }),
      'regions.update missing': () => regions.update('nope', {}),
      'regions.remove missing': () => regions.remove('nope'),
      'poi.create name': () => poi.create({}),
      'poi.update missing': () => poi.update('nope', {}),
      'poi.remove missing': () => poi.remove('nope'),
      'gear.addCustom type': () => gear.addCustom('bad', {}),
      'gear.addCustom data': () => gear.addCustom('camera', null),
      'gear.removeCustom prefix': () => gear.removeCustom('x'),
      'gear.removeCustom missing': () => gear.removeCustom('custom-nope'),
      'gear.createSetup name': () => gear.createSetup({}),
      'gear.createSetup telescope': () => gear.createSetup({ name: 'n' }),
      'gear.createSetup camera': () => gear.createSetup({ name: 'n', telescopeId: 't' }),
      'gear.replaceSetup fields': () => gear.replaceSetup('s', {}),
      'gear.setSetupEnabled type': () => gear.setSetupEnabled('s', 'yes'),
      'gear.setSetupEnabled missing': () => gear.setSetupEnabled('nope', true),
      'gear.removeSetup missing': () => gear.removeSetup('nope'),
      'settings.update locked': () => settings.update({ apiKey: 'k' }),
      'settings.removeApiKey locked': () => settings.removeApiKey(),
    };
  });
  afterEach(() => conn.close());

  it('gives every rejection a stable upper-snake-case code', async () => {
    for (const [name, run] of Object.entries(paths)) {
      let caught: unknown;
      try {
        await run();
      } catch (e) {
        caught = e;
      }
      expect(isDomainError(caught), `${name} rejects with a DomainError`).toBe(true);
      expect((caught as DomainError).code, name).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });
});
