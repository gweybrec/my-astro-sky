#!/usr/bin/env node
// Parse a Chrome DevTools performance trace (Trace-*.json) and print the hottest
// functions by self time and inclusive time, as a % of active (non-idle) CPU.
//
// Usage: node parse-trace.mjs <trace.json> [topN=30]
//
// The trace embeds a CPU sampling profile across `Profile` + `ProfileChunk` events:
//   - cpuProfile.nodes:   { id, callFrame:{functionName,url,lineNumber}, parent }
//   - cpuProfile.samples: leaf node id per sample
//   - timeDeltas:         microseconds attributed to each sample
// Self time = sum of deltas whose leaf is a node. Inclusive time = add each sample's
// delta to every ancestor (deduped per sample so recursion isn't double-counted).

import { readFileSync } from 'node:fs';

const file = process.argv[2];
const topN = Number(process.argv[3] || 30);
if (!file) {
  console.error('Usage: node parse-trace.mjs <trace.json> [topN]');
  process.exit(1);
}

const t = JSON.parse(readFileSync(file, 'utf8'));
const events = Array.isArray(t) ? t : t.traceEvents;

const nodes = {};
let samples = [];
let deltas = [];
for (const e of events) {
  if (e.name === 'ProfileChunk' && e.args?.data) {
    const cp = e.args.data.cpuProfile || {};
    if (cp.nodes) for (const n of cp.nodes) nodes[n.id] = { cf: n.callFrame, parent: n.parent };
    if (cp.samples) samples = samples.concat(cp.samples);
    if (e.args.data.timeDeltas) deltas = deltas.concat(e.args.data.timeDeltas);
  }
}

const fn = (id) => (nodes[id] ? nodes[id].cf.functionName || '(anonymous)' : '?');
const key = (cf) =>
  `${cf.functionName || '(anonymous)'}  @${(cf.url || '').split('/').pop()}:${cf.lineNumber}`;

const selfByFn = {};
let total = 0;
let idle = 0;
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const d = deltas[i] || 0;
  total += d;
  const k = key(nodes[id]?.cf || {});
  selfByFn[k] = (selfByFn[k] || 0) + d;
  if (fn(id) === '(idle)') idle += d;
}
const active = total - idle || 1;

const inclByFn = {};
for (let i = 0; i < samples.length; i++) {
  const d = deltas[i] || 0;
  let id = samples[i];
  const seen = new Set();
  while (id != null && nodes[id]) {
    const k = key(nodes[id].cf);
    if (!seen.has(k)) {
      seen.add(k);
      inclByFn[k] = (inclByFn[k] || 0) + d;
    }
    id = nodes[id].parent;
  }
}

const ms = (us) => (us / 1000).toFixed(1).padStart(8);
const pct = (us) => `${((100 * us) / active).toFixed(1).padStart(5)}%`;
const top = (obj) =>
  Object.entries(obj)
    .filter(([k]) => !k.startsWith('(idle)'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

console.log(
  `samples ${samples.length}  total ${(total / 1000).toFixed(0)}ms  ` +
    `idle ${(idle / 1000).toFixed(0)}ms  active ${(active / 1000).toFixed(0)}ms\n`,
);
console.log('=== TOP SELF TIME (ms, %active) ===');
for (const [k, us] of top(selfByFn)) console.log(ms(us), pct(us), k);
console.log('\n=== TOP INCLUSIVE TIME (ms, %active) ===');
for (const [k, us] of top(inclByFn)) console.log(ms(us), pct(us), k);
