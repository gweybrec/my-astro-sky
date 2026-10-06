/**
 * A fake of `@capacitor/filesystem` in memory: it reproduces the plugin's base64 interface (text in, bytes
 * stored), rejects `stat` and `deleteFile` for a missing file, and a `fetch` that, like the phone's local
 * server, answers 200 with an HTML page for an address it does not know.
 */
import type { CapacitorFilesystem } from '@myastrosky/backend-local/capacitor-blob-store';

export interface FakeFilesystem extends CapacitorFilesystem {
  files: Map<string, Uint8Array>;
  /** The longest base64 text received by one call: pieces must stay small. */
  maxDataLength: number;
  /** Makes the n-th write call (1-based) reject; 0 = never. */
  failOnWrite: number;
  convertFileSrc: (uri: string) => string;
  fetch: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

const ROOT = 'file:///data/user/0/app/files';
const PREFIX = 'http://localhost/_capacitor_file_';

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

export function createFakeFilesystem(): FakeFilesystem {
  const files = new Map<string, Uint8Array>();
  let writes = 0;
  const fake: FakeFilesystem = {
    files,
    maxDataLength: 0,
    failOnWrite: 0,
    async writeFile({ path, data }) {
      writes++;
      fake.maxDataLength = Math.max(fake.maxDataLength, data.length);
      if (fake.failOnWrite && writes === fake.failOnWrite) throw new Error('disk full');
      files.set(path, fromBase64(data));
    },
    async appendFile({ path, data }) {
      writes++;
      fake.maxDataLength = Math.max(fake.maxDataLength, data.length);
      if (fake.failOnWrite && writes === fake.failOnWrite) throw new Error('disk full');
      const old = files.get(path);
      if (!old) throw new Error('File does not exist');
      const add = fromBase64(data);
      const out = new Uint8Array(old.length + add.length);
      out.set(old);
      out.set(add, old.length);
      files.set(path, out);
    },
    async stat({ path }) {
      const f = files.get(path);
      if (!f) throw new Error('File does not exist');
      return { size: f.length };
    },
    async deleteFile({ path }) {
      if (!files.delete(path)) throw new Error('File does not exist');
    },
    async mkdir() {},
    async getUri({ path }) {
      return { uri: `${ROOT}/${path}` };
    },
    convertFileSrc: (uri) => uri.replace('file://', PREFIX),
    async fetch(url) {
      const path = decodeURIComponent(url.replace(`${PREFIX}/data/user/0/app/files/`, ''));
      const f = url.startsWith(PREFIX) ? files.get(path) : undefined;
      const body = f ?? new TextEncoder().encode('<!doctype html><html></html>');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      };
    },
  };
  return fake;
}
