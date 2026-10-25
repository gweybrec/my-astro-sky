// @vitest-environment node
/** The phone's blob store over a fake Filesystem plugin, and the same suite on the server's adapter. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  BLOB_PIECE_BYTES,
  createCapacitorBlobStore,
  ensureDirectory,
  toBase64,
  toBase64Js,
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

  it('writes in pieces of the size the adapter is given', async () => {
    const fake = createFakeFilesystem();
    const store = createCapacitorBlobStore({
      filesystem: fake,
      convertFileSrc: fake.convertFileSrc,
      fetch: fake.fetch,
      directory: 'DATA',
      folder: 'uploads',
      pieceBytes: 3000,
    });
    await store.init();
    await store.put('p.jpg', new Uint8Array(10_000).fill(7));
    expect(fake.maxDataLength).toBeLessThanOrEqual(4000);
    expect(fake.files.get('uploads/p.jpg')!.length).toBe(10_000);
  });

  it('encodes base64 the same with and without the native encoder', () => {
    const bytes = new Uint8Array(100_003).map((_, i) => (i * 31 + 5) % 256);
    const expected = Buffer.from(bytes).toString('base64');
    expect(toBase64Js(bytes)).toBe(expected);
    expect(toBase64(bytes)).toBe(expected);
    expect(toBase64(new Uint8Array(0))).toBe('');
  });

  it('rejects when a write fails, leaving no partial file and the old file whole', async () => {
    const fake = createFakeFilesystem();
    const store = await openPhoneStore(fake);
    await store.put('x.jpg', new Uint8Array([1, 2, 3]));
    fake.failOnWrite = 3; // the append after the first piece of the second put
    await expect(store.put('x.jpg', new Uint8Array(2 * BLOB_PIECE_BYTES))).rejects.toThrow(
      'disk full',
    );
    expect([...fake.files.keys()]).toEqual(['uploads/x.jpg']);
    expect([...(await store.get('x.jpg'))!]).toEqual([1, 2, 3]);
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

describe('ensureDirectory', () => {
  it('does not ask the plugin to create a folder that exists (it would log the refusal)', async () => {
    const stat = vi.fn().mockResolvedValue({ size: 0 });
    const mkdir = vi.fn();
    await ensureDirectory({ stat, mkdir }, 'DATA', 'uploads');
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('creates a missing folder and tolerates a refusal', async () => {
    const stat = vi.fn().mockRejectedValue(new Error('missing'));
    const mkdir = vi.fn().mockRejectedValue(new Error('exists'));
    await expect(ensureDirectory({ stat, mkdir }, 'DATA', 'uploads')).resolves.toBeUndefined();
    expect(mkdir).toHaveBeenCalledWith({ path: 'uploads', directory: 'DATA', recursive: true });
  });
});
