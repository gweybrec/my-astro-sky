// @vitest-environment node
/** The in-memory ZIP of the phone and the server's archiver/unzipper read each other's archives. */
import { PassThrough } from 'stream';
import { describe, it, expect } from 'vitest';
import { newZipBundle, openZipBundle } from '@myastrosky/backend-local/bundle-fflate';
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
});
