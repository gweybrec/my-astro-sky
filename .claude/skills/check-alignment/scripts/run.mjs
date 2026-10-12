// The one command of the alignment check:
//   node .claude/skills/check-alignment/scripts/run.mjs <app> [--view <name>] [--verbose] [--crop <view>:<n>] [--inject "<css>"]
// It starts what the app's rules file asks for (on free ports, in a new temporary folder), seeds the test data, opens
// the views, measures, stops everything it started, and prints the result. Exit code: 0 aligned, 1 misaligned,
// 2 set-up problem. BROWSER_CHANNEL (default msedge) names the installed browser; nothing is downloaded.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SetupError,
  freePort,
  killTree,
  makeTempFolder,
  portInUse,
  removeFolder,
  startNode,
  waitReady,
} from './launch.mjs';
import {
  cropFailure,
  describe,
  figureOf,
  isBad,
  measureInPage,
  runActions,
  scaleText,
  waitStill,
} from './engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const START = Date.now();
const ZOOM = 1.3;
const PARALLEL = Number(process.env.CHECK_PARALLEL) || 4;

// ── arguments ───────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const appName = args.find(
  (a) =>
    !a.startsWith('--') &&
    a !== option('--view') &&
    a !== option('--crop') &&
    a !== option('--inject'),
);
const only = option('--view');
const verbose = flag('--verbose');
const cropSpec = option('--crop');
const inject = option('--inject');

const started = [];
let tmp = null;
let ports = [];
let cleaned = false;
let browserRef = null;
const answers = new Map();

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const handle of started.reverse()) killTree(handle);
  if (tmp) removeFolder(tmp);
}
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

const fail = (code, message) => {
  console.log(message);
  process.exitCode = code;
};

async function main() {
  if (!appName) throw new SetupError('Name the app: run.mjs mobile (a file in rules/).');
  const file = path.join(here, '..', 'rules', `${appName}.mjs`);
  if (!existsSync(file))
    throw new SetupError(`No rules file for "${appName}" (expected rules/${appName}.mjs).`);
  const app = await import(pathToFileURL(file).href);
  const views = app.views.filter((v) => !only || v.name === only);
  if (!views.length) {
    throw new SetupError(
      `No view named "${only}". Views: ${app.views.map((v) => v.name).join(', ')}.`,
    );
  }

  let chromium;
  try {
    ({ chromium } = createRequire(path.join(repo, 'package.json'))('playwright-core'));
  } catch {
    throw new SetupError('playwright-core is not installed: run npm install.');
  }

  // Servers, on free ports and a new empty folder.
  for (const step of app.prepare ?? []) {
    const result = spawnSync(process.execPath, step.args, { cwd: step.cwd, windowsHide: true });
    if (result.status !== 0)
      throw new SetupError(`A preparation step failed: ${step.args.join(' ')}`);
  }
  ports = [await freePort(), await freePort()];
  tmp = makeTempFolder();
  for (const spec of app.servers({ ports, tmp })) {
    const handle = startNode(spec);
    started.push(handle);
    await waitReady(handle, spec.ready);
  }
  const seeded = await app.seed({ ports });
  const base = app.baseUrl({ ports });

  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'msedge',
      headless: true,
    });
  } catch {
    throw new SetupError(
      `No browser found for the channel "${process.env.BROWSER_CHANNEL || 'msedge'}": install Microsoft Edge or Chrome, or set BROWSER_CHANNEL (msedge, chrome).`,
    );
  }

  browserRef = browser;

  const open = async (job, deviceScaleFactor = 1) => {
    const context = await browser.newContext({
      viewport: { width: job.size[0], height: job.size[1] },
      deviceScaleFactor,
    });
    await context.addInitScript(
      ([entries, key, lang, cleared]) => {
        try {
          for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
          localStorage.setItem(key, lang);
          for (const k of cleared) localStorage.removeItem(k);
        } catch {
          /* the page then starts with its defaults */
        }
      },
      [seeded.storage ?? {}, app.language.key, job.lang, job.view.clearStorage ?? []],
    );
    if (app.cachedPrefixes?.length) {
      await context.route(
        (url) => app.cachedPrefixes.some((prefix) => url.pathname.startsWith(prefix)),
        async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const key = route.request().url();
          let hit = answers.get(key);
          if (!hit) {
            const response = await route.fetch();
            hit = {
              status: response.status(),
              headers: response.headers(),
              body: await response.body(),
            };
            if (hit.status === 200) answers.set(key, hit);
          }
          return route.fulfill(hit);
        },
      );
    }
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    const view = job.view;
    const route = typeof view.path === 'function' ? view.path(seeded.ids) : view.path;
    await page.goto(base + route, { waitUntil: 'load' });
    await page.waitForSelector(view.ready, { timeout: 30000 }).catch(async () => {
      await context.close();
      throw new Error(`"${view.ready}" did not appear (${problems[0] ?? 'no error in the page'})`);
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await runActions(page, view.open);
    if (view.scope) await waitStill(page, view.scope);
    await page.waitForTimeout(300);
    if (inject) await page.addStyleTag({ content: inject });
    return { context, page };
  };

  const measure = async (page, view) => {
    const { found, missingScope } = await page.evaluate(measureInPage, [
      app.rules,
      view.scope ?? null,
    ]);
    if (missingScope) throw new Error(`"${view.scope}" is not on the page`);
    await page.evaluate(
      (f) => {
        window.__alignFound = f;
      },
      found.map((m) => ({ ...m, bad: false })),
    );
    return found;
  };

  const runJob = async (job) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { context, page } = await open(job);
        try {
          const results = [];
          for (const zoom of job.zooms) {
            if (zoom !== 1) await page.evaluate(scaleText, zoom);
            for (const m of await measure(page, job.view)) results.push({ ...m, zoom });
          }
          return results.map((m) => ({ ...m, job }));
        } finally {
          await context.close();
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new SetupError(
      `View "${job.view.name}" at ${job.size.join('x')} did not open: ${String(lastError.message).split('\n')[0]}`,
    );
  };

  // The jobs: every view at every size; the views with variants also in every language and at 130 % text.
  const jobs = [];
  for (const view of views) {
    for (const size of app.sizes) {
      const langs = view.variants ? app.language.all : [app.language.all[0]];
      for (const lang of langs) {
        jobs.push({ view, size, lang, zooms: view.variants ? [1, ZOOM] : [1] });
      }
    }
  }
  // Order the jobs so that the first loads warm the dev server up one by one.
  const measurements = [];
  const queue = [...jobs];
  const warm = queue.splice(0, 1);
  measurements.push(...(await runJob(warm[0])));
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (queue.length) measurements.push(...(await runJob(queue.shift())));
    }),
  );

  // Report.
  const label = (m) =>
    `${m.job.size.join('x')}${m.job.lang !== app.language.all[0] || m.zoom !== 1 ? ` ${m.job.lang}${m.zoom !== 1 ? ` x${m.zoom}` : ''}` : ''}`;
  const lines = [];
  const perRule = new Map(app.rules.map((r) => [r.id, { n: 0, max: 0 }]));
  const bad = new Map();
  for (const m of measurements) {
    const stat = perRule.get(m.rule);
    stat.n += 1;
    stat.max = Math.max(stat.max, figureOf(m));
    if (!isBad(m)) continue;
    const key = [m.job.view.name, m.job.size.join('x'), m.rule, describe(m)].join('|');
    const known = bad.get(key);
    if (!known) bad.set(key, { m, count: 1 });
    else {
      known.count += 1;
      if (m.job.lang === app.language.all[0] && m.zoom === 1 && known.m.zoom !== 1) known.m = m;
    }
  }
  for (const [id, stat] of perRule) {
    lines.push(
      `${id.padEnd(12)} ${String(stat.n).padStart(5)} measurements   largest ${stat.max.toFixed(1)} px`,
    );
  }
  if (verbose) {
    const byJob = new Map();
    for (const m of measurements) {
      const key = `${m.job.view.name} ${label(m)}`;
      const row = byJob.get(key) ?? {};
      row[m.rule] = Math.max(row[m.rule] ?? 0, figureOf(m));
      byJob.set(key, row);
    }
    for (const [key, row] of byJob) {
      lines.push(
        `  ${key}: ${Object.entries(row)
          .map(([r, v]) => `${r} ${v.toFixed(1)}`)
          .join(', ')}`,
      );
    }
  }
  const order = (m) => [
    app.views.findIndex((v) => v === m.job.view),
    app.sizes.findIndex((z) => z === m.job.size),
    app.rules.findIndex((r) => r.id === m.rule),
  ];
  const failing = [...bad.values()].sort((x, y) => {
    const [a, b] = [order(x.m), order(y.m)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
  for (const { m, count } of failing.slice(0, 60)) {
    const who = m.b ? `${m.a} vs ${m.b}` : m.a;
    lines.push(
      `${m.job.view.name}  ${label(m)}  ${m.rule}  ${who}  ${describe(m)}${count > 1 ? `  (+${count - 1} like it)` : ''}`,
    );
  }
  if (failing.length > 60) lines.push(`... ${failing.length - 60} more failing lines`);
  const seconds = Math.round((Date.now() - START) / 1000);
  lines.push(`${views.length} views, ${measurements.length} measurements, ${seconds} s`);

  // One enlarged picture of one failure, on request.
  if (cropSpec) {
    const [viewName, nText] = cropSpec.split(':');
    const n = Number(nText) || 1;
    const hit = failing.filter(({ m }) => m.job.view.name === viewName)[n - 1];
    if (!hit) {
      lines.push(`No failing row ${n} in view "${viewName}": no picture.`);
    } else {
      const dir = path.join(repo, '.playwright-mcp', 'alignment');
      mkdirSync(dir, { recursive: true });
      const job = { ...hit.m.job, zooms: [1] };
      const { context, page } = await open(job, 3);
      try {
        if (hit.m.zoom !== 1) await page.evaluate(scaleText, hit.m.zoom);
        const found = await measure(page, job.view);
        const flagged = found.map((m) => ({ ...m, bad: isBad(m) }));
        await page.evaluate((f) => {
          window.__alignFound = f;
        }, flagged);
        const index = flagged.findIndex(
          (m) => m.rule === hit.m.rule && m.a === hit.m.a && m.b === hit.m.b && m.bad,
        );
        const nth = flagged.slice(0, index + 1).filter((m) => m.bad).length;
        const out = await cropFailure(page, nth, path.join(dir, `${viewName}-${n}.png`));
        lines.push(out ? `Picture: ${out}` : 'The failure did not appear again: no picture.');
      } finally {
        await context.close();
      }
    }
  }
  lines.push(failing.length === 0 ? 'PASS' : `FAIL (${failing.length})`);
  console.log(lines.join('\n'));
  process.exitCode = failing.length === 0 ? 0 : 1;
}

try {
  await main();
} catch (error) {
  if (error instanceof SetupError) fail(2, `Set-up problem: ${error.message}`);
  else fail(2, `Set-up problem: ${error.stack ?? error}`);
} finally {
  await browserRef?.close().catch(() => {});
  cleanup();
  if (ports.length) {
    await new Promise((r) => setTimeout(r, 300));
    for (const port of ports) {
      if (await portInUse(port)) console.error(`Warning: port ${port} is still in use.`);
    }
  }
  if (tmp && existsSync(tmp)) console.error(`Warning: ${tmp} could not be deleted.`);
}
