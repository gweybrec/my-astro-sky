// @vitest-environment node
// happy-dom's Blob does not survive IndexedDB's structured clone; Node's does, as the browser's does.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import {
  configureBatchKeep,
  createIndexedDbBatchStore,
  forgetBatch,
  isKeptItem,
  keepBatch,
  keptStateOf,
  restoreBatch,
  stateAfterRestart,
  type BatchKeepStore,
  type KeptBatchState,
  type KeptEntry,
} from '../../src/batch-keep';
import { makeItem } from '../helpers/batch-item';

const entry = (
  id: string,
  file: File,
  state: Partial<KeptBatchState> = {},
  rawFile: File | null = null,
): KeptEntry => ({
  id,
  file,
  rawFile,
  state: { ...keptStateOf(makeItem()), ...state },
});

/** The app started again: a new store on the same database reads the photos back. */
async function restart(factory: IDBFactory) {
  configureBatchKeep(createIndexedDbBatchStore(factory));
  return restoreBatch();
}

describe('the photos of "Ajouter des photos", kept until they are saved', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
    configureBatchKeep(createIndexedDbBatchStore(factory));
  });

  it('keeps the photos, their files and what was typed across a restart, in their order', async () => {
    const png = new File(['png-bytes'], 'M31.png', { type: 'image/png' });
    const fits = new File(['fits-bytes'], 'M31.fit', { type: 'application/fits' });
    const jpeg = new File(['jpeg-bytes'], 'M42.jpg', { type: 'image/jpeg' });
    await keepBatch([
      entry('b', jpeg, { labels: ['hiver'], notes: 'nuit claire', customName: 'Orion' }),
      entry('a', png, { rawName: 'M31.fit', status: 'failed', error: 'no solution' }, fits),
    ]);

    const kept = await restart(factory);
    expect(kept.map((k) => k.id)).toEqual(['b', 'a']);
    expect(kept[0].state).toMatchObject({
      labels: ['hiver'],
      notes: 'nuit claire',
      customName: 'Orion',
    });
    expect([kept[0].file.name, kept[0].file.type, await kept[0].file.text()]).toEqual([
      'M42.jpg',
      'image/jpeg',
      'jpeg-bytes',
    ]);
    expect(kept[0].rawFile).toBeNull();
    expect(kept[1].state).toMatchObject({
      status: 'failed',
      error: 'no solution',
      rawName: 'M31.fit',
    });
    expect([kept[1].rawFile!.name, await kept[1].rawFile!.text()]).toEqual([
      'M31.fit',
      'fits-bytes',
    ]);
    expect(await kept[1].file.text()).toBe('png-bytes');
  });

  it('writes the files once and the state only when it changes', async () => {
    const calls: string[] = [];
    const inner = createIndexedDbBatchStore(factory);
    const spy: BatchKeepStore = {
      ...inner,
      putFiles: async (...a) => {
        calls.push('files');
        return inner.putFiles(...a);
      },
      putState: async (...a) => {
        calls.push('state');
        return inner.putState(...a);
      },
    };
    configureBatchKeep(spy);
    const file = new File(['x'], 'M1.jpg', { type: 'image/jpeg' });
    await keepBatch([entry('a', file)]);
    await keepBatch([entry('a', file)]);
    expect(calls).toEqual(['files', 'state']);
    await keepBatch([entry('a', file, { notes: 'changed' })]);
    expect(calls).toEqual(['files', 'state', 'state']);
    // A conversion gives the photo its PNG: the files are written again.
    await keepBatch([
      entry('a', new File(['png'], 'M1.png', { type: 'image/png' }), { notes: 'changed' }),
    ]);
    expect(calls).toEqual(['files', 'state', 'state', 'files']);
  });

  it('forgets a photo no longer in the window or stored since, and all of them once the window is closed', async () => {
    const file = (n: string) => new File([n], `${n}.jpg`, { type: 'image/jpeg' });
    await keepBatch([entry('a', file('a')), entry('b', file('b')), entry('c', file('c'))]);
    await keepBatch([entry('a', file('a')), entry('c', file('c'))]);
    expect((await restart(factory)).map((k) => k.id)).toEqual(['a', 'c']);

    await forgetBatch();
    expect(await restart(factory)).toEqual([]);
  });

  it('keeps only the photos not stored yet', () => {
    expect(isKeptItem(makeItem())).toBe(true);
    expect(isKeptItem(makeItem({ photo: { id: 'p1' } as never }))).toBe(false);
  });

  it('reads nothing back from a database that cannot be opened, without throwing', async () => {
    configureBatchKeep({
      all: async () => {
        throw new Error('no database');
      },
    } as unknown as BatchKeepStore);
    expect(await restoreBatch()).toEqual([]);
  });
});

describe('where a kept photo stands when the app starts again', () => {
  const base = keptStateOf(makeItem());
  it('follows an astrometry.net solve again from its submission, under a new job', () => {
    const online = { submissionId: 42, jobId: 'old-job', sentAt: 's', fits: false };
    expect(stateAfterRestart({ ...base, status: 'solving', online })).toMatchObject({
      status: 'unfinished',
      online: { submissionId: 42, sentAt: 's', fits: false },
    });
    expect(stateAfterRestart({ ...base, status: 'solving', online }).online).not.toHaveProperty(
      'jobId',
    );
  });

  it('puts a local solve, or an online one never given a submission, back to solve', () => {
    expect(stateAfterRestart({ ...base, status: 'solving', solver: 'astap' })).toMatchObject({
      status: 'pending',
      online: null,
    });
    expect(
      stateAfterRestart({
        ...base,
        status: 'waiting',
        online: { sentAt: 's', jobId: 'j', fits: false },
      }),
    ).toMatchObject({ status: 'pending', online: null });
  });

  it('leaves any other state as it was', () => {
    for (const status of ['pending', 'success', 'failed', 'unfinished', 'converting'] as const) {
      expect(stateAfterRestart({ ...base, status }).status).toBe(status);
    }
  });
});
