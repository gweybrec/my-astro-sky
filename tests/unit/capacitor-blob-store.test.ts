// @vitest-environment node
/** The phone's blob store over a fake Filesystem plugin, and the same suite on the server's adapter. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BLOB_PIECE_BYTES,
  createCapacitorBlobStore,
} from '@myastrosky/backend-local/capacitor-blob-store';
import { createFsBlobStore } from '../../server/blob-store';
import { describeBlobStoreConformance } from '../helpers/blob-store-conformance';
import { createFakeFilesystem } from '../helpers/fake-filesystem';

async function openPhoneStore(fake = createFakeFilesystem()) {
  const store = createCapacitorBlobStore({
    filesystem: fake,
    convertFileSrc: fake.convertFileSrc,
    fetch: fake.fetch,
    directory: 'DATA',
    folder: 'uploads',
  });
  await store.init();
  return store;
}

describeBlobStoreConformance('server fs store', async () =>
  createFsBlobStore(fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-blobs-'))),
);
describeBlobStoreConformance('phone store over the fake Filesystem', () => openPhoneStore());

describe('createCapacitorBlobStore', () => {
  it('writes in pieces of at most 1 MB of bytes and never one text of the whole file', async () => {
    const fake = createFakeFilesystem();
    const store = await openPhoneStore(fake);
    await store.put('big.jpg', new Uint8Array(3 * BLOB_PIECE_BYTES + 5).fill(9));
    expect(fake.maxDataLength).toBeLessThanOrEqual(Math.ceil(BLOB_PIECE_BYTES / 3) * 4);
    expect(fake.files.get('uploads/big.jpg')!.length).toBe(3 * BLOB_PIECE_BYTES + 5);
  });

  it('removes the partial file and rejects when a write fails', async () => {
    const fake = createFakeFilesystem();
    const store = await openPhoneStore(fake);
    fake.failOnWrite = 2;
    await expect(store.put('x.jpg', new Uint8Array(2 * BLOB_PIECE_BYTES))).rejects.toThrow(
      'disk full',
    );
    expect(fake.files.has('uploads/x.jpg')).toBe(false);
  });

  it('returns null for a missing file although the local server answers 200', async () => {
    const store = await openPhoneStore();
    expect(await store.get('nothing.jpg')).toBeNull();
  });

  it('gives a synchronous address once initialised', async () => {
    const store = await openPhoneStore();
    expect(store.url('a.jpg')).toBe(
      'http://localhost/_capacitor_file_/data/user/0/app/files/uploads/a.jpg',
    );
  });

  it('refuses names that leave the folder', async () => {
    const store = await openPhoneStore();
    await expect(store.put('../x.jpg', new Uint8Array(1))).rejects.toThrow();
  });
});
