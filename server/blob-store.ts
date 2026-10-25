import fs from 'fs';
import path from 'path';
import type { BlobStore } from '@myastrosky/core/ports/blob-store';

/**
 * A blob store over one directory (the uploads folder): a blob is the file of that name. A put writes a hidden
 * `.<name>.part` first and renames it over the file, so a failed write leaves the old file whole.
 */
export function createFsBlobStore(dir: string): BlobStore {
  return {
    async put(name, bytes) {
      const target = path.join(dir, name);
      const part = path.join(dir, `.${name}.part`);
      try {
        await fs.promises.writeFile(part, bytes);
        await fs.promises.rename(part, target);
      } catch (err) {
        await fs.promises.unlink(part).catch(() => undefined);
        throw err;
      }
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
