/**
 * Backup archives in memory, over `fflate`: the phone has no streams to write to, so the archive is built
 * from the files added and handed back as bytes, and an archive to read is held as bytes. Entry names are the
 * ones the server's archiver writes (`manifest.json`, `images/…`, …); a name that could leave its folder is refused.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { isValidZipEntryPath } from '@myastrosky/core/domain/backup';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';

/** Builds an archive in memory: `add` every file, then `finish` for the bytes. */
export function newZipBundle(): { writer: BundleWriter; finish(): Promise<Uint8Array> } {
  const files: Zippable = {};
  return {
    writer: {
      async add(name, bytes) {
        if (!isValidZipEntryPath(name)) throw new Error(`Invalid archive entry name: ${name}`);
        files[name] = bytes;
      },
    },
    // Level 1, like the server: pictures are already compressed.
    finish: async () => zipSync(files, { level: 1 }),
  };
}

/** Opens an archive held in memory. Nothing is decompressed until a file is read. */
export async function openZipBundle(bytes: Uint8Array): Promise<BundleReader> {
  const sizes = new Map<string, number>();
  // A filter that keeps nothing lists the entries (their names and sizes) without decompressing any.
  unzipSync(bytes, {
    filter: (entry) => {
      sizes.set(entry.name, entry.originalSize);
      return false;
    },
  });
  return {
    async names() {
      return [...sizes.keys()];
    },
    async read(name) {
      if (!sizes.has(name)) return null;
      return unzipSync(bytes, { filter: (entry) => entry.name === name })[name] ?? null;
    },
    async size(name) {
      return sizes.get(name) ?? null;
    },
  };
}
