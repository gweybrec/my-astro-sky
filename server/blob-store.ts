import fs from 'fs';
import path from 'path';
import { isSafeBlobName, type BlobStore } from '@myastrosky/core/ports/blob-store';

/**
 * A blob store over one directory (the uploads folder): a blob is the file of that name. A put writes a hidden
 * `.<name>.part` first and renames it over the file, so a failed write leaves the old file whole. A name with a
 * folder part (`../x`) is refused, so no file outside the directory is ever read, written or deleted.
 */
export function createFsBlobStore(dir: string): BlobStore {
  const root = path.resolve(dir);
  const pathOf = (name: string): string => {
    const target = path.resolve(root, name);
    if (!isSafeBlobName(name) || path.dirname(target) !== root) {
      throw new Error(`Invalid blob name: ${name}`);
    }
    return target;
  };

  return {
    async put(name, bytes) {
      const target = pathOf(name);
      const part = path.join(root, `.${name}.part`);
      try {
        await fs.promises.writeFile(part, bytes);
        await fs.promises.rename(part, target);
      } catch (err) {
        await fs.promises.unlink(part).catch(() => undefined);
        throw err;
      }
    },
    async get(name) {
      const target = pathOf(name);
      try {
        return new Uint8Array(await fs.promises.readFile(target));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async size(name) {
      try {
        return (await fs.promises.stat(pathOf(name))).size;
      } catch {
        return null;
      }
    },
    async remove(name) {
      const target = pathOf(name);
      try {
        await fs.promises.unlink(target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
  };
}
