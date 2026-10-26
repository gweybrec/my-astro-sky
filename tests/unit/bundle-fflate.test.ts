// @vitest-environment node
/** The in-memory ZIP of the phone and the server's archiver/unzipper read each other's archives. */
import { PassThrough } from 'stream';
import { unzipSync } from 'fflate';
import { describe, it, expect } from 'vitest';
import { ZipArchive } from 'archiver';
import {
  newZipBundle,
  openZipBundle,
  openZipRanges,
  type RangeSource,
} from '@myastrosky/backend-local/bundle-fflate';
import { createZipResponseWriter, openZipBundle as openServerZip } from '../../server/bundle-zip';

const text = (s: string) => new TextEncoder().encode(s);
const FILES: [string, Uint8Array][] = [
  ['manifest.json', text('{"manifestVersion":1,"photos":[]}')],
  ['images/a.jpg', new Uint8Array([1, 2, 3, 4, 5])],
  ['plans.json', text('[]')],
];

describe('bundle-fflate', () => {
  it('reads an archive written by the server', async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    const ended = new Promise((resolve) => output.once('end', resolve));
    const writer = createZipResponseWriter(output, () => {});
    for (const [name, bytes] of FILES) await writer.add(name, bytes);
    await writer.finalize();
    await ended;

    const reader = await openZipBundle(new Uint8Array(Buffer.concat(chunks)));
    expect(await reader.names()).toEqual(FILES.map(([name]) => name));
    for (const [name, bytes] of FILES) {
      expect(await reader.read(name)).toEqual(bytes);
      expect(await reader.size(name)).toBe(bytes.length);
    }
    expect(await reader.read('missing')).toBeNull();
    expect(await reader.size('missing')).toBeNull();
  });

  it('writes an archive the server reads', async () => {
    const zip = newZipBundle();
    for (const [name, bytes] of FILES) await zip.writer.add(name, bytes);
    const reader = await openServerZip(Buffer.from(await zip.finish()));
    expect((await reader.names()).sort()).toEqual(FILES.map(([name]) => name).sort());
    for (const [name, bytes] of FILES) {
      expect(await reader.read(name)).toEqual(bytes);
      expect(await reader.size(name)).toBe(bytes.length);
    }
  });

  it('refuses an entry name that could leave its folder', async () => {
    const zip = newZipBundle();
    await expect(zip.writer.add('images/../secret', text('x'))).rejects.toThrow(/Invalid/);
    await expect(zip.writer.add('/etc/passwd', text('x'))).rejects.toThrow(/Invalid/);
  });

  it('writes an empty archive that reads back empty', async () => {
    const reader = await openZipBundle(await newZipBundle().finish());
    expect(await reader.names()).toEqual([]);
  });

  it('stores the pictures and deflates the other entries', async () => {
    const zip = newZipBundle();
    const json = text(JSON.stringify({ photos: Array(200).fill('a photo') }));
    const picture = new Uint8Array(4096).map((_, i) => (i * 7) % 251);
    await zip.writer.add('manifest.json', json);
    await zip.writer.add('images/a.jpg', picture);
    const methods = new Map<string, number>();
    const archive = await zip.finish();
    unzipSync(archive, {
      filter: (entry) => {
        methods.set(entry.name, entry.compression);
        return false;
      },
    });
    expect(methods.get('images/a.jpg')).toBe(0);
    expect(methods.get('manifest.json')).toBe(8);
    const reader = await openZipBundle(archive);
    expect(await reader.read('images/a.jpg')).toEqual(picture);
    expect(await reader.read('manifest.json')).toEqual(json);
  });

  describe('read by pieces', () => {
    /** A range source over `bytes` that records every piece asked for. */
    function counted(bytes: Uint8Array) {
      const asked: [number, number][] = [];
      const source: RangeSource = {
        size: bytes.length,
        read: async (start, end) => {
          asked.push([start, end]);
          return bytes.slice(start, end);
        },
      };
      return { source, asked, total: () => asked.reduce((n, [s, e]) => n + e - s, 0) };
    }

    it('reads a zip64 archive written by archiver', async () => {
      const archive = new ZipArchive({ zlib: { level: 1 }, forceZip64: true });
      const chunks: Buffer[] = [];
      archive.on('data', (c: Buffer) => chunks.push(c));
      const ended = new Promise((resolve) => archive.once('end', resolve));
      for (const [name, bytes] of FILES) archive.append(Buffer.from(bytes), { name });
      await archive.finalize();
      await ended;

      const reader = await openZipRanges(counted(new Uint8Array(Buffer.concat(chunks))).source);
      expect(await reader.names()).toEqual(FILES.map(([name]) => name));
      for (const [name, bytes] of FILES) {
        expect(await reader.read(name)).toEqual(bytes);
        expect(await reader.size(name)).toBe(bytes.length);
      }
    });

    it('reads only the end, the directory and the entry asked for', async () => {
      const zip = newZipBundle();
      const big = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
      await zip.writer.add('images/big.jpg', big);
      await zip.writer.add('manifest.json', text('{"photos":[]}'));
      const bytes = await zip.finish();
      const { source, total } = counted(bytes);

      const reader = await openZipRanges(source);
      expect(await reader.size('images/big.jpg')).toBe(big.length);
      expect(await reader.read('manifest.json')).toEqual(text('{"photos":[]}'));
      // The picture's bytes are never asked for unless it is read.
      expect(total()).toBeLessThan(EOCD_SEARCH_BOUND);
      // Compared as bytes: toEqual walks a 1 MB array element by element and takes seconds.
      expect(Buffer.from(await reader.read('images/big.jpg')).equals(big)).toBe(true);
    });

    it('opens an archive larger than the phone could hold, reading only a few pieces', async () => {
      // A 400 MB stored entry of zeros, never read, then a small manifest: built from its records, not in memory.
      const padding = 400 * 1024 * 1024;
      const archive = virtualArchive(padding, text('{"photos":[]}'));
      const reader = await openZipRanges(archive);
      expect(await reader.size('padding.bin')).toBe(padding);
      expect(await reader.read('manifest.json')).toEqual(text('{"photos":[]}'));
    });

    it('refuses a truncated archive', async () => {
      const bytes = await openableArchive();
      await expect(
        openZipRanges(counted(bytes.subarray(0, bytes.length - 30)).source),
      ).rejects.toThrow(/Invalid backup archive/);
      await expect(openZipBundle(text('not a zip'))).rejects.toThrow(/Invalid backup archive/);
    });
  });
});

/** Larger than anything the reader asks for at opening a small archive (its end and its directory). */
const EOCD_SEARCH_BOUND = 70 * 1024;

async function openableArchive(): Promise<Uint8Array> {
  const zip = newZipBundle();
  for (const [name, bytes] of FILES) await zip.writer.add(name, bytes);
  return zip.finish();
}

/**
 * A stored entry `padding.bin` of `padding` zero bytes, then a stored `manifest.json`, then the central directory
 * and the end record. Only the records are held; the padding is answered as zeros.
 */
function virtualArchive(padding: number, manifest: Uint8Array): RangeSource {
  const encoder = new TextEncoder();
  const local = (name: string, size: number) => {
    const n = encoder.encode(name);
    const header = new Uint8Array(30 + n.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, n.length, true);
    header.set(n, 30);
    return header;
  };
  const central = (name: string, size: number, offset: number) => {
    const n = encoder.encode(name);
    const header = new Uint8Array(46 + n.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, n.length, true);
    view.setUint32(42, offset, true);
    header.set(n, 46);
    return header;
  };
  const padHeader = local('padding.bin', padding);
  const manifestAt = padHeader.length + padding;
  const manifestHeader = local('manifest.json', manifest.length);
  const cdAt = manifestAt + manifestHeader.length + manifest.length;
  const cd = new Uint8Array([
    ...central('padding.bin', padding, 0),
    ...central('manifest.json', manifest.length, manifestAt),
  ]);
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, 2, true);
  view.setUint16(10, 2, true);
  view.setUint32(12, cd.length, true);
  view.setUint32(16, cdAt, true);
  // The held pieces, by offset; anything between them is padding (zeros).
  const tail = new Uint8Array([...manifestHeader, ...manifest, ...cd, ...eocd]);
  const size = manifestAt + tail.length;
  return {
    size,
    read: async (start, end) => {
      const out = new Uint8Array(end - start);
      for (let i = start; i < end; i++) {
        if (i < padHeader.length) out[i - start] = padHeader[i];
        else if (i >= manifestAt) out[i - start] = tail[i - manifestAt];
      }
      return out;
    },
  };
}
