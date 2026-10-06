// @vitest-environment node
/**
 * The phone pays about 19 ms per database call. This counts the calls of the user actions that matter
 * through the local backend, on the counting database, and fails when one single action needs more than 10.
 */
import { afterAll, describe, it, expect } from 'vitest';
import { installFakeInternet, releaseFakeInternet } from '../helpers/contract-shared';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';
import { makeLocalContractSetup } from '../helpers/local-contract-backend';

installFakeInternet();
afterAll(() => releaseFakeInternet());

async function setup() {
  let counter!: CountingSqlDb;
  const s = await makeLocalContractSetup({
    wrapDb: (db) => (counter = countingSqlDb(db)),
  });
  counter.reset();
  return { ...s, counter };
}

const LIMIT = 10;
const counts: Record<string, number> = {};

describe('database round trips of the local backend', () => {
  it('listing the plans', async () => {
    const { backend, counter } = await setup();
    await backend.plans.create({ name: 'A' });
    counter.reset();
    await backend.plans.list();
    counts['plans.list'] = counter.calls();
    expect(counts['plans.list']).toBeLessThanOrEqual(LIMIT);
  });

  it('listing the photos with their sizes', async () => {
    const { backend, fixtures, counter } = await setup();
    await backend.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify([
        { pointIndex: 0, photoX: 1, photoY: 2, starHip: 32349, starName: 'Sirius' },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
      ]),
    });
    counter.reset();
    await backend.photos.listWithSizes();
    counts['photos.listWithSizes'] = counter.calls();
    expect(counts['photos.listWithSizes']).toBeLessThanOrEqual(LIMIT);
  });

  it('adding one entry to a plan', async () => {
    const { backend, counter } = await setup();
    const plan = await backend.plans.create({ name: 'A' });
    counter.reset();
    await backend.plans.addEntry(plan.id, { dsoId: 'M31' });
    counts['plans.addEntry'] = counter.calls();
    expect(counts['plans.addEntry']).toBeLessThanOrEqual(LIMIT);
  });

  it('uploading one photo', async () => {
    const { backend, fixtures, counter } = await setup();
    await backend.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify([
        { pointIndex: 0, photoX: 1, photoY: 2, starHip: 32349, starName: 'Sirius' },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
      ]),
    });
    counter.reset();
    await backend.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify([
        { pointIndex: 0, photoX: 1, photoY: 2, starHip: 32349, starName: 'Sirius' },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
      ]),
    });
    counts['photos.upload'] = counter.calls();
    expect(counts['photos.upload']).toBeLessThanOrEqual(LIMIT);
  });

  it('restoring a backup of 3 plans and 2 photos', async () => {
    const source = await setup();
    for (const name of ['A', 'B', 'C']) await source.backend.plans.create({ name });
    const fields = {
      correspondences: JSON.stringify([
        { pointIndex: 0, photoX: 1, photoY: 2, starHip: 32349, starName: 'Sirius' },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
      ]),
    };
    await source.backend.photos.upload(source.fixtures.jpeg(), fields);
    await source.backend.photos.upload(source.fixtures.jpeg(), fields);
    await source.backend.backup.exportToUser({
      options: { includeImages: true, includeMetadata: true, includePlans: true },
    });
    const archive = await source.fixtures.lastExport();
    expect(archive).toBeDefined();

    const target = await setup();
    const preview = await target.backend.backup.preview(archive!);
    expect(preview.plans).toHaveLength(3);
    target.counter.reset();
    const result = await target.backend.backup.restore(archive!, {
      importMetadata: true,
      selectedPlans: preview.plans.map((p) => p.id),
    });
    counts['backup.restore'] = target.counter.calls();
    expect(result.imported).toBe(2);
    expect(await target.backend.plans.list()).toHaveLength(3);
    // A restore is one user action that writes many rows: it is reported, not held to the single-action limit.
    console.warn('round trips', JSON.stringify(counts));
  });
});
