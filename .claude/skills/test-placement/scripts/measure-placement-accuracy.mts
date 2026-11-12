// How far the app's photo placement is from each file's own plate solution (WCS, SIP included), in photo pixels.
// Run from the repo root: npx tsx .claude/skills/test-placement/scripts/measure-placement-accuracy.mts [files…]
// (default: every .fit/.fits/.tif/.tiff in test-photos/). Files are read as imported with their own solution (rows
// counted from the bottom). For each photo and each projection mode the sky map uses (pole stereo and fisheye, local
// sky at 0, 3 and 5 h from the meridian at latitude 45°), the worst error over a 21 × 21 grid:
//   model9  the photo's sky model from the 9 reference points stored at import (`wcsToCorrespondences`)
//   stars6  the model from 6 points in the central 70 % (a photo placed from matched stars)
//   mesh    the sky map's drawing of model9 (its mesh of triangles in the projection) against the WCS projected
//   affine  a single affine fit in the projection, the placement used before the model (reference)
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve('.');
const mod = (m: string) => import(pathToFileURL(join(ROOT, 'packages/core/src', m)).href);
const wcsMod = await mod('wcs.ts');
const proj = await mod('projection.ts');
const place = await mod('photo-placement.ts');
const affine = await mod('affine.ts');
const { extractWCS, wcsToCorrespondences, parseFITSHeader, extractFITSHeaderFromFITS } = wcsMod;

type P = { x: number; y: number };
const D = Math.PI / 180;

function sipSum(t: Record<string, number>, u: number, v: number) {
  let s = 0;
  for (const [k, c] of Object.entries(t)) {
    const [i, j] = k.split('_').map(Number);
    s += c * u ** i * v ** j;
  }
  return s;
}
/** The file's own solution: display pixel (0-based, y down) → RA/Dec. */
function wcsToSky(w: any, H: number, fy: boolean, px: number, py: number) {
  const u = px + 1 - w.CRPIX1;
  const v = (fy ? H - py : py + 1) - w.CRPIX2;
  const dx = w.sip ? u + sipSum(w.sip.a, u, v) : u;
  const dy = w.sip ? v + sipSum(w.sip.b, u, v) : v;
  const xi = (w.CD1_1 * dx + w.CD1_2 * dy) * D;
  const eta = (w.CD2_1 * dx + w.CD2_2 * dy) * D;
  const s0 = Math.sin(w.CRVAL2 * D);
  const c0 = Math.cos(w.CRVAL2 * D);
  const den = c0 - eta * s0;
  const ra = w.CRVAL1 + Math.atan2(xi, den) / D;
  return {
    ra: ((ra % 360) + 360) % 360,
    dec: Math.atan2(s0 + eta * c0, Math.hypot(xi, den)) / D,
  };
}
const sep = (a: any, b: any) =>
  Math.hypot((((a.ra - b.ra + 540) % 360) - 180) * Math.cos(a.dec * D), a.dec - b.dec);

function tiffDims(buf: Uint8Array): [number, number] {
  const le = buf[0] === 0x49;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const ifd = u32(4);
  let w = 0;
  let h = 0;
  for (let k = 0; k < u16(ifd); k++) {
    const e = ifd + 2 + k * 12;
    const val = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
    if (u16(e) === 256) w = val;
    if (u16(e) === 257) h = val;
  }
  return [w, h];
}

const MODES = [
  ['pole stereo', () => (proj.setCenterMode('pole'), proj.setProjectionMode('stereo'))],
  ['pole fisheye', () => (proj.setCenterMode('pole'), proj.setProjectionMode('fisheye'))],
  ...[0, 3, 5].flatMap((ha) =>
    (['stereo', 'fisheye'] as const).map(
      (m) =>
        [
          `local ${m} HA+${ha}h`,
          (ra: number) => {
            proj.setCenterMode('zenith');
            proj.setProjectionMode(m);
            proj.setProjectionObserver((((ra / 15 + ha) % 24) + 24) % 24, 45);
          },
        ] as const,
    ),
  ),
] as const;

const args = process.argv.slice(2);
const files = args.length
  ? args
  : readdirSync(join(ROOT, 'test-photos'))
      .filter((f) => /\.(fits?|tiff?)$/i.test(f))
      .map((f) => join(ROOT, 'test-photos', f));

console.log(`${'photo'.padEnd(28)}${'mode'.padEnd(22)}  model9  stars6    mesh  affine`);
for (const file of files) {
  const buf = new Uint8Array(readFileSync(file));
  const ext = extname(file).toLowerCase();
  const w = extractWCS(buf, ext);
  if (!w) continue;
  const [W, H] = ext.startsWith('.fit')
    ? (() => {
        const h = parseFITSHeader(extractFITSHeaderFromFITS(buf));
        return [h.NAXIS1 as number, h.NAXIS2 as number];
      })()
    : w.NAXIS1 && w.NAXIS2
      ? [w.NAXIS1, w.NAXIS2]
      : tiffDims(buf);
  const fy = true; // files imported with their own solution count rows from the bottom
  const scaleDeg = Math.sqrt(Math.abs(w.CD1_1 * w.CD2_2 - w.CD1_2 * w.CD2_1));
  const grid: P[] = [];
  for (let j = 0; j <= 20; j++)
    for (let i = 0; i <= 20; i++) grid.push({ x: (W * i) / 20, y: (H * j) / 20 });
  const truth = grid.map((p) => wcsToSky(w, H, fy, p.x, p.y));
  const photo9 = { width: W, height: H, correspondences: wcsToCorrespondences(w, W, H, fy) };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 6 }, (_, k) => {
    const x = W * (0.15 + 0.7 * rnd());
    const y = H * (0.15 + 0.7 * rnd());
    const s = wcsToSky(w, H, fy, x, y);
    return {
      pointIndex: k,
      photoX: x,
      photoY: y,
      starHip: 0,
      starName: '',
      starRa: s.ra,
      starDec: s.dec,
    };
  });
  const photo6 = { width: W, height: H, correspondences: stars };
  const m9 = place.photoSkyModel(photo9);
  const m6 = place.photoSkyModel(photo6);
  const skyErr = (m: any) =>
    Math.max(...grid.map((p, k) => sep(m.toSky(p.x, p.y), truth[k]))) / scaleDeg;
  const e9 = skyErr(m9);
  const e6 = skyErr(m6);
  const ctr = wcsToSky(w, H, fy, W / 2, H / 2);
  for (const [name, set] of MODES) {
    set(ctr.ra);
    const t = truth.map((s) => proj.projectContinued(s.ra, s.dec));
    const c = proj.projectContinued(ctr.ra, ctr.dec);
    const cx = wcsToSky(w, H, fy, W / 2 + 1, H / 2);
    const pcx = proj.projectContinued(cx.ra, cx.dec);
    const unit = Math.hypot(pcx.x - c.x, pcx.y - c.y); // projection units per photo pixel at the centre
    const mesh = place.projectPhotoMesh(m9);
    const { n, nodes } = mesh;
    const at = (i: number, j: number): P => ({
      x: nodes[(j * (n + 1) + i) * 2],
      y: nodes[(j * (n + 1) + i) * 2 + 1],
    });
    const meshAt = (p: P): P => {
      const fx = Math.min(n - 1e-9, (p.x / W) * n);
      const fj = Math.min(n - 1e-9, (p.y / H) * n);
      const i = Math.floor(fx);
      const j = Math.floor(fj);
      const u = fx - i;
      const v = fj - j;
      const [p00, p10, p01, p11] = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      return u + v <= 1
        ? {
            x: p00.x + u * (p10.x - p00.x) + v * (p01.x - p00.x),
            y: p00.y + u * (p10.y - p00.y) + v * (p01.y - p00.y),
          }
        : {
            x: p11.x + (1 - u) * (p01.x - p11.x) + (1 - v) * (p10.x - p11.x),
            y: p11.y + (1 - u) * (p01.y - p11.y) + (1 - v) * (p10.y - p11.y),
          };
    };
    const eMesh =
      Math.max(
        ...grid.map((p, k) => {
          const q = meshAt(p);
          return Math.hypot(q.x - t[k].x, q.y - t[k].y);
        }),
      ) / unit;
    const pp = photo9.correspondences.map((k: any) => ({ x: k.photoX, y: k.photoY }));
    const A = affine.computeAffineLSQ(
      pp,
      photo9.correspondences.map((k: any) => proj.projectContinued(k.starRa, k.starDec)),
    );
    const eAff =
      Math.max(
        ...grid.map((p, k) =>
          Math.hypot(A.a * p.x + A.c * p.y + A.e - t[k].x, A.b * p.x + A.d * p.y + A.f - t[k].y),
        ),
      ) / unit;
    const f = (v: number) => v.toFixed(1).padStart(8);
    console.log(
      `${file.split(/[\\/]/).pop()!.slice(0, 27).padEnd(28)}${name.padEnd(22)}${f(e9)}${f(e6)}${f(eMesh)}${f(eAff)}  (mesh ${n}×${n})`,
    );
  }
}
