import { createRequire } from 'module';
import type { Writable } from 'stream';
import { ZipArchive } from 'archiver';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';

// unzipper is CommonJS-only and has no ESM export, so it can't be `import`ed under
// "type": "module" — createRequire is a permanent interop shim for it, unrelated to archiver.
const _require = createRequire(import.meta.url);
const unzipper = _require('unzipper') as typeof import('unzipper');

export interface ZipResponseWriter extends BundleWriter {
  /** Ends the archive; the response ends when everything is flushed. */
  finalize(): Promise<void>;
  /** Drops the archive after a failure. */
  abort(): void;
}

/**
 * A writer over an `archiver` ZIP that streams to `output` (the HTTP response). The archive is created on
 * the first `add` (or on `finalize`), through `onStart`, which sets the response headers. `add` resolves when
 * archiver has taken the entry, so a file is not read before the previous one has gone out.
 */
export function createZipResponseWriter(output: Writable, onStart: () => void): ZipResponseWriter {
  let archive: ZipArchive | null = null;
  const pending = new Set<(err: Error) => void>();

  const start = (): ZipArchive => {
    if (archive) return archive;
    onStart();
    const created = new ZipArchive({ zlib: { level: 1 } });
    created.on('error', (err) => {
      console.error('[Export] archiver error:', err);
      for (const reject of pending) reject(err);
    });
    // A client that goes away must not leave an export waiting for ever.
    output.once('close', () => {
      for (const reject of pending) reject(new Error('Export interrupted'));
    });
    created.pipe(output);
    archive = created;
    return created;
  };

  return {
    add(name, bytes) {
      const zip = start();
      return new Promise<void>((resolve, reject) => {
        const onEntry = (entry: { name: string }): void => {
          if (entry.name !== name) return;
          zip.off('entry', onEntry);
          pending.delete(reject);
          resolve();
        };
        pending.add(reject);
        zip.on('entry', onEntry);
        zip.append(Buffer.from(bytes), { name });
      });
    },
    async finalize() {
      await start().finalize();
    },
    abort() {
      archive?.abort();
    },
  };
}

/** A reader over a ZIP held in memory (the uploaded bundle). */
export async function openZipBundle(buffer: Buffer): Promise<BundleReader> {
  const dir = await unzipper.Open.buffer(buffer);
  const files = dir.files;
  const find = (name: string) => files.find((f) => f.path === name);
  return {
    async names() {
      return files.map((f) => f.path);
    },
    async read(name) {
      const entry = find(name);
      return entry ? new Uint8Array(await entry.buffer()) : null;
    },
    async size(name) {
      return find(name)?.uncompressedSize ?? null;
    },
  };
}
