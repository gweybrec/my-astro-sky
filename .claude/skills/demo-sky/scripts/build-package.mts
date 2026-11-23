/**
 * Builds the demo shared sky from the working folder (DEMO_SKY_DIR): solved.json (placement), details.json (license
 * and source, from Commons), entries.json (what each Commons page states, read by hand) and sky.json (the sky's id and
 * sender name, kept across versions so that a new version is an update of the same visit).
 *
 * Run from the repository root:  npx tsx .claude/skills/demo-sky/scripts/build-package.mts <version label>
 * Writes "<sender name> <label>.myastrosky" (keyboard characters only) and CREDITS-<label>.html in the working folder,
 * then reads the package back through the app's own parser.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  SHARE_FORMAT_VERSION,
  SHARE_KIND,
  SHARE_MANIFEST_NAME,
  isValidSkyId,
  parseShareManifest,
  shareFileName,
  type ShareManifest,
  type SharedPhoto,
} from '@myastrosky/core/domain/shared-sky';
import { createZipWriter } from '@myastrosky/core/zip-writer';
import { stripGps } from '@myastrosky/core/strip-gps';
import { parseFITSHeader, wcsFromHeader, wcsToCorrespondences } from '@myastrosky/core/wcs';
import {
  findDSOIdsFromCorrespondences,
  setDsoCatalog,
} from '@myastrosky/core/catalog/dso-registry';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROOT = process.env.DEMO_SKY_DIR ? resolve(process.env.DEMO_SKY_DIR) : '';
const VERSION = process.argv[2] ?? '';
if (!ROOT || !VERSION) {
  console.error('Usage: DEMO_SKY_DIR=<working folder> npx tsx build-package.mts <version label, e.g. v3>');
  process.exit(1);
}

/** What one Commons page states about a photo, as read by hand. Absent or null: the page does not say. */
interface Entry {
  objectName: string;
  author: string;
  /** YYYY-MM-DD (stored as midnight UTC) or a full ISO date; null when the page gives no capture date. */
  date?: string | null;
  integrations?: { frames: number; seconds: number; filter: string }[];
  gear?: { setup?: string; telescope?: string; camera?: string; accessory?: string };
  captureDetails?: Record<string, number | string>;
  note?: string | null;
}
interface Solved {
  wcs: string;
  width: number;
  height: number;
  title: string;
  image: string;
}
interface Detail {
  page: string;
  license: string;
  licenseUrl?: string;
}

const readJson = async <T,>(name: string): Promise<T> =>
  JSON.parse(await readFile(join(ROOT, name), 'utf-8')) as T;

const sky = await readJson<{ skyId: string; senderName: string }>('sky.json');
if (!isValidSkyId(sky.skyId)) throw new Error('sky.json: skyId must be letters, digits and dashes (8 to 64)');
const solved = (await readJson<{ solved: Record<string, Solved> }>('solved.json')).solved;
const details = await readJson<Record<string, Detail>>('details.json');
const entries = await readJson<Record<string, Entry>>('entries.json');

const missing = Object.keys(solved).filter((id) => !entries[id] || !details[id]);
if (missing.length) {
  throw new Error(`No entry or no fetched page for: ${missing.join(', ')} (details.py fetch, then entries.json)`);
}

setDsoCatalog(JSON.parse(await readFile(join(REPO, 'public/data/dso.json'), 'utf-8')), {}, 'en');

const photos: SharedPhoto[] = [];
const pictures: { file: string; bytes: Uint8Array }[] = [];
const credits: { entry: Entry; detail: Detail; title: string }[] = [];

for (const [dsoId, s] of Object.entries(solved)) {
  const entry = entries[dsoId];
  const detail = details[dsoId];
  const wcs = wcsFromHeader(parseFITSHeader(await readFile(join(ROOT, s.wcs), 'utf-8')));
  if (!wcs) throw new Error(`Unreadable WCS for ${dsoId}`);
  // solve-field on a JPEG: row 1 at the top (docs/dev/solve-field-placement.md). No point when the solution is unusable.
  const correspondences = wcsToCorrespondences(wcs, s.width, s.height, false);
  if (correspondences.length !== 9) throw new Error(`Reference points rejected for ${dsoId}`);
  const found = findDSOIdsFromCorrespondences(correspondences, s.width, s.height);

  const file = `${dsoId}.jpg`;
  const bytes = stripGps(new Uint8Array(await readFile(join(ROOT, s.image))));
  pictures.push({ file, bytes });

  const lines = [
    entry.objectName,
    '',
    `Photo: ${entry.author}`,
    `License: ${detail.license}${detail.licenseUrl ? ` (${detail.licenseUrl})` : ''}`,
    `Source: Wikimedia Commons, ${detail.page}`,
    'Resized and converted to JPEG for this demo sky; placed by a local astrometry.net (solve-field) plate solve.',
  ];
  if (entry.note) lines.push('', entry.note);
  const date = entry.date ? (entry.date.length === 10 ? `${entry.date}T00:00:00.000Z` : entry.date) : null;

  photos.push({
    id: randomUUID(),
    file,
    bytes: bytes.length,
    // Shown as the photo's name on the map and in the gallery; the Commons file name is in the notes' source link.
    originalName: entry.objectName,
    width: s.width,
    height: s.height,
    quarterTurns: 0,
    correspondences,
    dsoIds: [dsoId, ...found.filter((id) => id !== dsoId)],
    labels: [],
    notes: lines.join('\n'),
    pointsOfInterest: [],
    observationDate: date,
    integrations: entry.integrations ?? [],
    author: entry.author,
    ...(entry.captureDetails && Object.keys(entry.captureDetails).length
      ? { captureDetails: entry.captureDetails }
      : {}),
    ...(entry.gear && Object.keys(entry.gear).length ? { gear: entry.gear } : {}),
  });
  credits.push({ entry, detail, title: s.title });
}

const manifest: ShareManifest = {
  kind: SHARE_KIND,
  formatVersion: SHARE_FORMAT_VERSION,
  skyId: sky.skyId,
  senderName: sky.senderName,
  sharedAt: new Date().toISOString(),
  photos,
  poiCategories: [],
};

// Keyboard characters only in the file name: "MyAstroSky demo · Wikimedia Commons" → "MyAstroSky demo - Wikimedia
// Commons v3"; accents dropped, any other character a hyphen. The sender name inside the package keeps its "·".
const keyboardName = `${sky.senderName} ${VERSION}`
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^\x20-\x7e]+/g, '-');
const out = join(ROOT, shareFileName(keyboardName));
if (existsSync(out)) throw new Error(`${out} exists: a built version is never overwritten; pick another label`);
const fh = await open(out, 'wx');
const { writer, finish } = createZipWriter({
  append: async (b) => {
    await fh.write(b);
  },
});
for (const p of pictures) await writer.add(`images/${p.file}`, p.bytes);
await writer.add(SHARE_MANIFEST_NAME, new TextEncoder().encode(JSON.stringify(manifest))); // the manifest goes last
await finish();
await fh.close();

// Read back through the app's own parser: every photo kept, with its author and its reference points.
const zip = unzipSync(new Uint8Array(await readFile(out)));
const back = parseShareManifest(JSON.parse(new TextDecoder().decode(zip[SHARE_MANIFEST_NAME])));
const problems: string[] = [];
if (back.photos.length !== photos.length) problems.push(`${back.photos.length}/${photos.length} photos kept`);
for (const p of back.photos) {
  if (!p.author) problems.push(`${p.file}: no author`);
  if (p.correspondences.length !== 9) problems.push(`${p.file}: ${p.correspondences.length} points`);
  if (zip[`images/${p.file}`]?.length !== p.bytes) problems.push(`${p.file}: picture`);
}
if (problems.length) throw new Error(problems.join('\n'));

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rows = credits
  .map(
    ({ entry, detail, title }) =>
      `<tr><td>${esc(entry.objectName)}</td><td>${esc(entry.author)}</td><td>${
        detail.licenseUrl
          ? `<a href="${esc(detail.licenseUrl)}">${esc(detail.license)}</a>`
          : esc(detail.license)
      }</td><td><a href="${esc(detail.page)}">${esc(title.replace(/^File:/, ''))}</a></td></tr>`,
  )
  .join('\n');
await writeFile(
  join(ROOT, `CREDITS-${VERSION}.html`),
  `<!doctype html><meta charset="utf-8"><title>${esc(sky.senderName)} – credits</title>
<style>body{font:14px system-ui,sans-serif;margin:2em;max-width:1100px}td,th{padding:4px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}</style>
<h1>${esc(sky.senderName)} – image credits</h1>
<p>All ${credits.length} images come from Wikimedia Commons and are used under the license shown. They were resized and converted to JPEG, and plate-solved locally to place them on the sky map. No other change was made.</p>
<table><tr><th>Object</th><th>Author</th><th>License</th><th>Commons file</th></tr>
${rows}
</table>
`,
  'utf-8',
);

console.log(`${photos.length} photos, ${((await stat(out)).size / 1e6).toFixed(1)} MB -> ${out}`);
