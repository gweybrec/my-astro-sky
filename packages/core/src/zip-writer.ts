/**
 * A ZIP archive written as it goes: each file added goes out to `sink` at once, and only the directory (a few dozen
 * bytes per file) is kept until `finish`. The phone writes its exports to a file this way, so an archive of several
 * gigabytes never sits in memory. Pictures (`images/…`) are stored as they are, the other files are deflated, and an
 * archive past 4 GB or 65,535 files gets the zip64 records (`zip-ranges.ts` and the usual tools read them).
 */
import { deflateSync } from 'fflate';
import { isValidZipEntryPath } from './domain/backup';
import type { BundleWriter } from './ports/bundle';

/** Where the archive goes: the pieces arrive in order, each awaited before the next. */
export interface ZipSink {
  append(bytes: Uint8Array): Promise<void>;
}

export interface ZipWriterOptions {
  /** The offset or file count from which the zip64 records are written (tests lower it). */
  zip64Above?: { offset?: number; count?: number };
}

const ZIP32_MAX = 0xffffffff;
const COUNT32_MAX = 0xffff;
/** Bit 11: the names are UTF-8. */
const FLAG_UTF8 = 0x0800;
/** 1 January 1980, the earliest date the format holds: the entries carry no date of their own. */
const DOS_DATE = 0x21;
const VERSION_PLAIN = 20;
const VERSION_ZIP64 = 45;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as a ZIP entry stores it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function setU64(view: DataView, at: number, value: number): void {
  view.setUint32(at, value % 2 ** 32, true);
  view.setUint32(at + 4, Math.floor(value / 2 ** 32), true);
}

interface DirectoryEntry {
  name: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/**
 * A writer over `sink`: `add` every file, then `finish`, which writes the directory. A name that could leave its
 * folder, or one already added, is refused.
 */
export function createZipWriter(
  sink: ZipSink,
  options: ZipWriterOptions = {},
): { writer: BundleWriter; finish(): Promise<void> } {
  const offsetLimit = options.zip64Above?.offset ?? ZIP32_MAX;
  const countLimit = options.zip64Above?.count ?? COUNT32_MAX;
  const encoder = new TextEncoder();
  const entries: DirectoryEntry[] = [];
  const names = new Set<string>();
  let offset = 0;

  const write = async (bytes: Uint8Array): Promise<void> => {
    await sink.append(bytes);
    offset += bytes.length;
  };

  return {
    writer: {
      async add(name, bytes) {
        if (!isValidZipEntryPath(name)) throw new Error(`Invalid archive entry name: ${name}`);
        if (names.has(name)) throw new Error(`Archive entry added twice: ${name}`);
        names.add(name);
        const stored = name.startsWith('images/');
        const data = stored ? bytes : deflateSync(bytes, { level: 1 });
        const entry: DirectoryEntry = {
          name: encoder.encode(name),
          method: stored ? 0 : 8,
          crc: crc32(bytes),
          compressedSize: data.length,
          size: bytes.length,
          offset,
        };
        const header = new Uint8Array(30 + entry.name.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, VERSION_PLAIN, true);
        view.setUint16(6, FLAG_UTF8, true);
        view.setUint16(8, entry.method, true);
        view.setUint16(12, DOS_DATE, true);
        view.setUint32(14, entry.crc, true);
        view.setUint32(18, entry.compressedSize, true);
        view.setUint32(22, entry.size, true);
        view.setUint16(26, entry.name.length, true);
        header.set(entry.name, 30);
        await write(header);
        await write(data);
        entries.push(entry);
      },
    },

    async finish() {
      const directoryAt = offset;
      const records: Uint8Array[] = [];
      for (const entry of entries) {
        // An entry is at most a typed array long, so only its place in the archive can need 64 bits.
        const far = entry.offset >= offsetLimit;
        const record = new Uint8Array(46 + entry.name.length + (far ? 12 : 0));
        const view = new DataView(record.buffer);
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, VERSION_ZIP64, true);
        view.setUint16(6, far ? VERSION_ZIP64 : VERSION_PLAIN, true);
        view.setUint16(8, FLAG_UTF8, true);
        view.setUint16(10, entry.method, true);
        view.setUint16(14, DOS_DATE, true);
        view.setUint32(16, entry.crc, true);
        view.setUint32(20, entry.compressedSize, true);
        view.setUint32(24, entry.size, true);
        view.setUint16(28, entry.name.length, true);
        view.setUint16(30, far ? 12 : 0, true);
        view.setUint32(42, far ? ZIP32_MAX : entry.offset, true);
        record.set(entry.name, 46);
        if (far) {
          const extra = 46 + entry.name.length;
          view.setUint16(extra, 0x0001, true);
          view.setUint16(extra + 2, 8, true);
          setU64(view, extra + 4, entry.offset);
        }
        records.push(record);
      }
      const directorySize = records.reduce((n, r) => n + r.length, 0);
      const zip64 =
        entries.length >= countLimit || directoryAt >= offsetLimit || directorySize >= ZIP32_MAX;
      const end = new Uint8Array(directorySize + (zip64 ? 56 + 20 : 0) + 22);
      let at = 0;
      for (const record of records) {
        end.set(record, at);
        at += record.length;
      }
      const view = new DataView(end.buffer);
      if (zip64) {
        view.setUint32(at, 0x06064b50, true);
        setU64(view, at + 4, 44);
        view.setUint16(at + 12, VERSION_ZIP64, true);
        view.setUint16(at + 14, VERSION_ZIP64, true);
        setU64(view, at + 24, entries.length);
        setU64(view, at + 32, entries.length);
        setU64(view, at + 40, directorySize);
        setU64(view, at + 48, directoryAt);
        at += 56;
        view.setUint32(at, 0x07064b50, true);
        setU64(view, at + 8, directoryAt + directorySize);
        view.setUint32(at + 16, 1, true);
        at += 20;
      }
      view.setUint32(at, 0x06054b50, true);
      view.setUint16(at + 8, zip64 ? COUNT32_MAX : entries.length, true);
      view.setUint16(at + 10, zip64 ? COUNT32_MAX : entries.length, true);
      view.setUint32(at + 12, zip64 ? ZIP32_MAX : directorySize, true);
      view.setUint32(at + 16, zip64 ? ZIP32_MAX : directoryAt, true);
      await write(end);
    },
  };
}
