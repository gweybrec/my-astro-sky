// Records a performance trace of the app's WebView over its debugging connection, the same file DevTools'
// Performance panel saves (CPU samples included), so profile-performance's parse-trace.mjs reads it unchanged.
// Use it instead of chrome://inspect, whose remote DevTools window does not save traces.
// Usage: node record-trace.mjs --serial <serial> [--seconds 8] [--out <file>] [--port 9223] [--package <app id>]
//   counts down, records for --seconds while you pan/zoom on the phone, then writes the trace
//   (default .playwright-mcp/Trace-phone-<time>.json, gitignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appId, parseArgs, repoRoot } from './adb.mjs';
import { connect } from './cdp-connect.mjs';

// The categories the Performance panel records with.
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
  'v8.execute',
  'blink.user_timing',
  'latencyInfo',
  'toplevel',
  'loading',
].join(',');

const { options } = parseArgs(process.argv.slice(2));
if (!options.serial) {
  console.error(
    'Usage: record-trace.mjs --serial <serial> [--seconds 8] [--out <file>] [--port 9223] [--package <app id>]',
  );
  process.exit(2);
}
const seconds = Number(options.seconds ?? 8);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(
  options.out ?? path.join(repoRoot, '.playwright-mcp', `Trace-phone-${stamp}.json`),
);

const { page, close } = await connect({
  serial: options.serial,
  port: Number(options.port ?? 9223),
  packageId: options.package ?? appId(),
});
try {
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));

  for (let i = 3; i > 0; i--) {
    console.log(`Recording in ${i}…`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: CATEGORIES.split(','), recordMode: 'recordContinuously' },
    transferMode: 'ReportEvents',
  });
  console.log(`Recording for ${seconds} s: pan and zoom the sky on the phone now.`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await cdp.send('Tracing.end');
  await done;

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ traceEvents: events }));
  console.log(`Saved ${events.length} events to ${out}`);
} finally {
  await close();
}
