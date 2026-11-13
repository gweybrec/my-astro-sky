import fsp from 'fs/promises';
import type { Writable } from 'stream';
import { ZipArchive } from 'archiver';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import { openZipRanges } from '@myastrosky/core/zip-ranges';

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
        // Pictures are already compressed: stored as they are, which is much faster; the JSON files are deflated.
        zip.append(Buffer.from(bytes), { name, store: name.startsWith('images/') });
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

/** A reader that holds a file open: `close` it when done. */
export interface ZipFileReader extends BundleReader {
  close(): Promise<void>;
}

/**
 * A reader over a ZIP file on disk, read by pieces: its end and its directory when opened, then one entry per
 * `read`. The archive is never held whole in memory, so its size has no limit.
 */
export async function openZipFile(filePath: string): Promise<ZipFileReader> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const reader = await openZipRanges({
      size,
      async read(start, end) {
        const out = Buffer.allocUnsafeSlow(end - start);
        let done = 0;
        while (done < out.length) {
          const { bytesRead } = await handle.read(out, done, out.length - done, start + done);
          if (bytesRead === 0) throw new Error('Invalid backup archive: truncated');
          done += bytesRead;
        }
        return new Uint8Array(out.buffer, out.byteOffset, out.length);
      },
    });
    return { ...reader, close: () => handle.close() };
  } catch (err) {
    await handle.close();
    throw err;
  }
}
