/**
 * Backup archives in memory, over `fflate`: the phone has no streams to write to, so the archive is built
 * from the files added and handed back as bytes; an archive to read is read by pieces. Entry names are the
 * ones the server's archiver writes (`manifest.json`, `images/…`, …); a name that could leave its folder is refused.
 */
import { inflateSync, zipSync, type Zippable } from 'fflate';
import { isValidZipEntryPath } from '@myastrosky/core/domain/backup';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';

/** Builds an archive in memory: `add` every file, then `finish` for the bytes. */
export function newZipBundle(): { writer: BundleWriter; finish(): Promise<Uint8Array> } {
  const files: Zippable = {};
  return {
    writer: {
      async add(name, bytes) {
        if (!isValidZipEntryPath(name)) throw new Error(`Invalid archive entry name: ${name}`);
        // Pictures are already compressed: stored as they are (level 0); the JSON files are deflated.
        files[name] = name.startsWith('images/') ? [bytes, { level: 0 }] : bytes;
      },
    },
    // Level 1, like the server, for the entries that are not pictures.
    finish: async () => zipSync(files, { level: 1 }),
  };
}

/** A file read by pieces: bytes `start` to `end` (excluded). */
export interface RangeSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/** The error of a file that is not a readable archive (a plain error, like fflate's before). */
const invalidArchive = (detail: string) => new Error(`Invalid backup archive: ${detail}`);

/** Fields of 0xFFFFFFFF are in the zip64 records. */
const ZIP32_MAX = 0xffffffff;
/** The end-of-central-directory record, at most a 65,535-byte comment before the file's end. */
const EOCD_SIZE = 22;
const EOCD_SEARCH = EOCD_SIZE + 0xffff;
const ZIP64_LOCATOR_SIZE = 20;

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const u64 = (view: DataView, at: number) =>
  view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32;

/**
 * Opens an archive read by pieces: the end of the file and its central directory when opened, then one entry's
 * header and data per `read`. The archive is never held whole in memory, so its size has no limit. Stored entries
 * (the pictures) come back as they are, deflated ones (the JSON files) are inflated.
 */
export async function openZipRanges(source: RangeSource): Promise<BundleReader> {
  const read = async (start: number, end: number) => {
    if (start < 0 || end > source.size || start > end) throw invalidArchive('truncated');
    return source.read(start, end);
  };

  const tailStart = Math.max(0, source.size - EOCD_SEARCH);
  const tail = await read(tailStart, source.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalidArchive('no end record');
  let count = tailView.getUint16(eocd + 10, true);
  let cdSize = tailView.getUint32(eocd + 12, true);
  let cdOffset = tailView.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === ZIP32_MAX || cdOffset === ZIP32_MAX) {
    const locator = eocd - ZIP64_LOCATOR_SIZE;
    if (locator < 0 || tailView.getUint32(locator, true) !== 0x07064b50) {
      throw invalidArchive('no zip64 locator');
    }
    const recordAt = u64(tailView, locator + 8);
    const record = await read(recordAt, recordAt + 56);
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (view.getUint32(0, true) !== 0x06064b50) throw invalidArchive('no zip64 record');
    count = u64(view, 32);
    cdSize = u64(view, 40);
    cdOffset = u64(view, 48);
  }

  const cd = await read(cdOffset, cdOffset + cdSize);
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cd.length || cdView.getUint32(at, true) !== 0x02014b50) {
      throw invalidArchive('bad central directory');
    }
    const nameLength = cdView.getUint16(at + 28, true);
    const extraLength = cdView.getUint16(at + 30, true);
    const commentLength = cdView.getUint16(at + 32, true);
    const entry: ZipEntry = {
      method: cdView.getUint16(at + 10, true),
      compressedSize: cdView.getUint32(at + 20, true),
      size: cdView.getUint32(at + 24, true),
      localOffset: cdView.getUint32(at + 42, true),
    };
    const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLength));
    // The zip64 extra field holds, in this order, the fields that are 0xFFFFFFFF above.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = cdView.getUint16(extra, true);
      const length = cdView.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        for (const key of ['size', 'compressedSize', 'localOffset'] as const) {
          if (entry[key] === ZIP32_MAX) {
            entry[key] = u64(cdView, field);
            field += 8;
          }
        }
      }
      extra += 4 + length;
    }
    entries.set(name, entry);
    at = extraEnd + commentLength;
  }

  return {
    async names() {
      return [...entries.keys()];
    },
    async read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const header = await read(entry.localOffset, entry.localOffset + 30);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (view.getUint32(0, true) !== 0x04034b50) throw invalidArchive('bad entry header');
      const dataAt = entry.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
      const data = await read(dataAt, dataAt + entry.compressedSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return inflateSync(data, { out: new Uint8Array(entry.size) });
      throw invalidArchive(`compression method ${entry.method}`);
    },
    async size(name) {
      return entries.get(name)?.size ?? null;
    },
  };
}

/** Opens an archive held in memory, by the same reader. */
export async function openZipBundle(bytes: Uint8Array): Promise<BundleReader> {
  return openZipRanges({
    size: bytes.byteLength,
    read: async (start, end) => bytes.subarray(start, end),
  });
}
