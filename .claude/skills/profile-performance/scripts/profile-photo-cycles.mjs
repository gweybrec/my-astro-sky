// The desktop app (dev server) in its own Chrome, for when the Playwright browser tool is busy or a CPU slowdown is
// wanted: the photo layer's state, console errors, a screenshot (.playwright-mcp/), this skill's pan and zoom benchmark
// (scripts/benchmark.js), then a CPU profile of 12 "pan, then stop" cycles (photos are hidden while the map moves and
// placed and drawn again once it stops) with the inclusive time of the photo code and the self time under
// applyTransform.
// Run from the repo root: node .claude/skills/profile-performance/scripts/profile-photo-cycles.mjs <label> [--cpu=4] [--url=http://localhost:5173]
// --cpu=4 slows the CPU four times, a stand-in for a phone.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright-core');

const label = process.argv[2] ?? 'run';
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) ?? '--cpu=1').slice(6));
const url = (
  process.argv.find((a) => a.startsWith('--url=')) ?? '--url=http://localhost:5173'
).slice(6);
const shots = `${process.cwd()}/.playwright-mcp`;
mkdirSync(shots, { recursive: true });
const benchmark = readFileSync(
  `${process.cwd()}/.claude/skills/profile-performance/scripts/benchmark.js`,
  'utf8',
)
  .replace(/^\/\/.*$/gm, '')
  .trim()
  .replace(/;\s*$/, '');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1600,1000'],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(9000); // catalogues, photos and their thumbnails

const state = await page.evaluate(() => {
  const layer = document.querySelector('#photo-layer');
  const gl = layer?.querySelector('canvas.photo-gl-canvas');
  return {
    glCanvas: gl
      ? {
          w: gl.width,
          h: gl.height,
          css: gl.style.width + '×' + gl.style.height,
        }
      : null,
    imgsInLayer: layer?.querySelectorAll('img').length ?? 0,
    clip: layer?.style.clipPath?.slice(0, 40),
  };
});
await page.screenshot({ path: `${shots}/photo-model-${label}.png` });

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const pan = await page.evaluate(`(${benchmark})('pan')`);
await page.waitForTimeout(400);
const zoom = await page.evaluate(`(${benchmark})('zoom')`);
await page.waitForTimeout(400);

// Pan-then-stop cycles under the CPU profiler.
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
const box = await page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const t0 = Date.now();
for (let c = 0; c < 12; c++) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 0; k < 10; k++)
    await page.mouse.move(box.x + (k + 1) * 6 * (c % 2 ? -1 : 1), box.y + k * 2);
  await page.mouse.up();
  await page.waitForTimeout(300); // the photos come back after 100 ms still
}
const wall = Date.now() - t0;
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map();
for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
const dt = (profile.endTime - profile.startTime) / profile.samples.length / 1000;
for (const [id, n] of counts) {
  const f = byId.get(id).callFrame.functionName || '(anon)';
  self.set(f, (self.get(f) ?? 0) + n * dt);
}
// Inclusive time of the photo layer's entry points.
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (const [id, n] of counts) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const f = byId.get(cur).callFrame.functionName;
    if (!f || seen.has(f)) continue;
    seen.add(f);
    incl.set(f, (incl.get(f) ?? 0) + n * dt);
  }
}
const pick = (m, names) => Object.fromEntries(names.map((k) => [k, +(m.get(k) ?? 0).toFixed(1)]));
const photoFns = [
  'updateTransforms',
  'placeAll',
  'placeEach',
  'applyTransform',
  'drawPhotos',
  'render',
  'geometryOf',
  'projectPhotoMesh',
  'meshCanvasAffine',
  'buildPhotoPoints',
  'fitPhotoAffine',
  'getPhotoCanvasQuads',
  'computePhotoQuadCorners',
  'texImage2D',
  'renderFrame',
];
const active = [...self.entries()]
  .filter(([k]) => k !== '(idle)' && k !== '(program)')
  .reduce((s, [, v]) => s + v, 0);

// Self time of what applyTransform calls (its subtree only).
const under = new Map();
for (const [id, n] of counts) {
  let inApply = false;
  for (let cur = parent.get(id); cur !== undefined; cur = parent.get(cur))
    if (byId.get(cur).callFrame.functionName === 'applyTransform') {
      inApply = true;
      break;
    }
  if (!inApply) continue;
  const f = byId.get(id).callFrame.functionName || '(anon)';
  under.set(f, (under.get(f) ?? 0) + n * dt);
}
console.log(
  'under applyTransform:',
  [...under.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
    .join(', '),
);
console.log(
  JSON.stringify(
    {
      label,
      cpu,
      state,
      errors: errors.slice(0, 10),
      pan,
      zoom,
      cycles: {
        wallMs: wall,
        activeMs: +active.toFixed(0),
        inclusiveMs: pick(incl, photoFns),
      },
    },
    null,
    1,
  ),
);
await browser.close();
