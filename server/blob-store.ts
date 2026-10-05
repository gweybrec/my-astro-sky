import fs from 'fs';
import path from 'path';
import type { BlobStore } from '@myastrosky/core/ports/blob-store';

/** A blob store over one directory (the uploads folder): a blob is the file of that name. */
export function createFsBlobStore(dir: string): BlobStore {
  return {
    async put(name, bytes) {
      await fs.promises.writeFile(path.join(dir, name), bytes);
    },
    async get(name) {
      try {
        return new Uint8Array(await fs.promises.readFile(path.join(dir, name)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async size(name) {
      try {
        return (await fs.promises.stat(path.join(dir, name))).size;
      } catch {
        return null;
      }
    },
    async remove(name) {
      try {
        await fs.promises.unlink(path.join(dir, name));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
  };
}
