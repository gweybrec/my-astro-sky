/**
 * The contract every `BlobStore` adapter must meet, as plain data (cases that throw on failure), so the same
 * cases run under Vitest on the server's adapter and inside the phone's WebView on the phone's.
 * `open` returns a store with none of the names the cases use.
 */
import type { BlobStore } from '../ports/blob-store';
import { bytesEqual, ok, patternBytes, toBe } from './conformance-assert';

export interface BlobStoreConformanceCase {
  name: string;
  run(open: () => Promise<BlobStore>): Promise<void>;
}

export const blobStoreConformanceCases: BlobStoreConformanceCase[] = [
  {
    name: 'put then get returns the same bytes, and size is their length',
    async run(open) {
      const store = await open();
      const bytes = patternBytes(5000, 7);
      await store.put('conf-a.jpg', bytes);
      bytesEqual(await store.get('conf-a.jpg'), bytes, 'get');
      toBe(await store.size('conf-a.jpg'), 5000, 'size');
      await store.remove('conf-a.jpg');
    },
  },
  {
    name: 'a missing blob: get and size give null',
    async run(open) {
      const store = await open();
      toBe(await store.get('conf-missing.jpg'), null, 'get');
      toBe(await store.size('conf-missing.jpg'), null, 'size');
    },
  },
  {
    name: 'remove deletes the blob; removing a missing one is not an error',
    async run(open) {
      const store = await open();
      await store.put('conf-r.jpg', patternBytes(10));
      await store.remove('conf-r.jpg');
      toBe(await store.get('conf-r.jpg'), null, 'get after remove');
      toBe(await store.size('conf-r.jpg'), null, 'size after remove');
      await store.remove('conf-r.jpg');
      await store.remove('conf-never-existed.jpg');
    },
  },
  {
    name: 'put on an existing name replaces the content (a shorter one leaves no tail)',
    async run(open) {
      const store = await open();
      await store.put('conf-o.jpg', patternBytes(3000, 1));
      const second = patternBytes(100, 2);
      await store.put('conf-o.jpg', second);
      bytesEqual(await store.get('conf-o.jpg'), second, 'get');
      toBe(await store.size('conf-o.jpg'), 100, 'size');
      await store.remove('conf-o.jpg');
    },
  },
  {
    name: 'a 3 MB blob comes back byte for byte',
    async run(open) {
      const store = await open();
      const bytes = patternBytes(3 * 1024 * 1024 + 123, 42);
      await store.put('conf-big.jpg', bytes);
      toBe(await store.size('conf-big.jpg'), bytes.length, 'size');
      bytesEqual(await store.get('conf-big.jpg'), bytes, 'get');
      await store.remove('conf-big.jpg');
    },
  },
  {
    name: 'an empty blob exists, with size 0',
    async run(open) {
      const store = await open();
      await store.put('conf-empty.jpg', new Uint8Array(0));
      const got = await store.get('conf-empty.jpg');
      ok(got !== null && got.length === 0, 'get of an empty blob gives an empty array, not null');
      toBe(await store.size('conf-empty.jpg'), 0, 'size');
      await store.remove('conf-empty.jpg');
    },
  },
  {
    name: 'the two name forms of the services: <id>.jpg and <id>_thumb.jpg',
    async run(open) {
      const store = await open();
      const id = '3f2b8c1e-5a6d-4e7f-9a01-b2c3d4e5f607';
      const a = patternBytes(400, 3);
      const b = patternBytes(200, 4);
      await store.put(`${id}.jpg`, a);
      await store.put(`${id}_thumb.jpg`, b);
      bytesEqual(await store.get(`${id}.jpg`), a, 'photo');
      bytesEqual(await store.get(`${id}_thumb.jpg`), b, 'thumbnail');
      await store.remove(`${id}.jpg`);
      toBe(await store.get(`${id}.jpg`), null, 'photo after remove');
      bytesEqual(await store.get(`${id}_thumb.jpg`), b, 'thumbnail untouched');
      await store.remove(`${id}_thumb.jpg`);
    },
  },
];
