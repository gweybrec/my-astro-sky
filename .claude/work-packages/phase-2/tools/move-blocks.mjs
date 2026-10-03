#!/usr/bin/env node
// Moves route blocks (and helper line ranges) from one file to another, byte for byte.
//
// Usage:
//   node move-blocks.mjs [--dry-run] <fromFile> <toFile> <routerVar> <item> [<item> ...]
//
// An item is "METHOD /path" (a route) or L<start>-<end> (1-based inclusive line range).
//
// Route item: finds the column-0 line where `app.<method>(` has the path as first argument (same
// line or next line). Block start = the `/**` line of the comment block directly above the route
// (`//` lines between the `*/` and the route belong to the block); with no such block, the
// contiguous `//` lines above the route. Block end = first later column-0 line that is `});` or `);`.
//
// The blocks are removed from <fromFile> and appended to <toFile> in their source order, each
// followed by one blank line. Only the leading `app.` of a route declaration is replaced, by
// `<routerVar>.`. <toFile> is created when missing. CRLF / LF is kept as found.
// A blank line that followed a removed block is removed with it only when the block was also
// preceded by a blank line, so two removals never leave a double blank line behind.
//
// Nothing is changed when an item matches zero or several places, or when two items overlap.

import fs from 'node:fs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const args = argv.filter((a) => a !== '--dry-run');
if (args.length < 4) {
  console.error(
    'Usage: node move-blocks.mjs [--dry-run] <fromFile> <toFile> <routerVar> <item> [<item> ...]',
  );
  process.exit(2);
}
const [fromFile, toFile, routerVar, ...items] = args;

function fail(message) {
  console.error(`move-blocks: ${message}`);
  process.exit(1);
}

const fromRaw = fs.readFileSync(fromFile, 'utf8');
const fromEol = fromRaw.includes('\r\n') ? '\r\n' : '\n';
const fromEndsWithEol = fromRaw.endsWith('\n');
const fromLines = fromRaw.split(/\r?\n/);
if (fromEndsWithEol) fromLines.pop(); // trailing empty element after the last EOL

const lineIsBlank = (i) => i < 0 || i >= fromLines.length || fromLines[i].trim() === '';

function findRoute(item) {
  const m = /^([A-Za-z]+)\s+(\S+)$/.exec(item);
  const method = m[1].toLowerCase();
  const routePath = m[2];
  const sameLine = new RegExp(`^app\\.${method}\\(\\s*(['"\`])${escapeRe(routePath)}\\1\\s*[,)]`);
  const openOnly = new RegExp(`^app\\.${method}\\(\\s*$`);
  const nextLine = new RegExp(`^\\s*(['"\`])${escapeRe(routePath)}\\1\\s*[,)]`);
  const hits = [];
  for (let i = 0; i < fromLines.length; i++) {
    const line = fromLines[i];
    if (sameLine.test(line) || (openOnly.test(line) && nextLine.test(fromLines[i + 1] ?? ''))) {
      hits.push(i);
    }
  }
  if (hits.length !== 1) fail(`item "${item}" matches ${hits.length} places (expected exactly 1)`);
  const routeLine = hits[0];

  // End: first later column-0 `});` or `);`.
  let end = -1;
  for (let i = routeLine + 1; i < fromLines.length; i++) {
    if (fromLines[i] === '});' || fromLines[i] === ');') {
      end = i;
      break;
    }
  }
  if (end < 0) fail(`item "${item}": no closing "});" or ");" found after line ${routeLine + 1}`);

  // Start: walk up over `//` lines, then over one block comment (`/** ... */`).
  let start = routeLine;
  let i = routeLine - 1;
  while (i >= 0 && fromLines[i].trimStart().startsWith('//')) i--;
  const lineCommentTop = i + 1; // topmost `//` line directly above the route (or routeLine)
  if (i >= 0 && fromLines[i].trimEnd().endsWith('*/')) {
    let j = i;
    while (j >= 0 && !fromLines[j].trimStart().startsWith('/*')) j--;
    if (j < 0) fail(`item "${item}": unterminated comment block above line ${routeLine + 1}`);
    start = j;
  } else {
    start = lineCommentTop;
  }
  return { item, start, end, routeLine, isRoute: true };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const blocks = items.map((item) => {
  const range = /^L(\d+)-(\d+)$/.exec(item);
  if (range) {
    const start = Number(range[1]) - 1;
    const end = Number(range[2]) - 1;
    if (!(start >= 0 && end >= start && end < fromLines.length)) {
      fail(`item "${item}" is outside the file (${fromLines.length} lines)`);
    }
    return { item, start, end, isRoute: false };
  }
  if (/^[A-Za-z]+\s+\S+$/.test(item)) return findRoute(item);
  return fail(`item "${item}" is neither "METHOD /path" nor L<start>-<end>`);
});

blocks.sort((a, b) => a.start - b.start);
for (let k = 1; k < blocks.length; k++) {
  if (blocks[k].start <= blocks[k - 1].end) {
    fail(`items "${blocks[k - 1].item}" and "${blocks[k].item}" overlap`);
  }
}

for (const b of blocks) {
  console.log(
    `${b.item}: lines ${b.start + 1}-${b.end + 1} (${b.end - b.start + 1} lines)` +
      (b.isRoute ? ` [route at line ${b.routeLine + 1}]` : ''),
  );
}
console.log(
  `total: ${blocks.length} blocks, ${blocks.reduce((n, b) => n + b.end - b.start + 1, 0)} lines`,
);
if (dryRun) {
  console.log('(dry run, nothing changed)');
  process.exit(0);
}

// Build the text to append.
const appended = [];
for (const b of blocks) {
  const chunk = fromLines.slice(b.start, b.end + 1);
  if (b.isRoute) {
    const k = b.routeLine - b.start;
    if (!chunk[k].startsWith('app.'))
      fail(`internal: route line of "${b.item}" does not start with app.`);
    chunk[k] = `${routerVar}.${chunk[k].slice('app.'.length)}`;
  }
  appended.push(...chunk, '');
}

// Remove from the source (bottom-up so indexes stay valid).
const toRemove = new Set();
for (const b of blocks) {
  for (let i = b.start; i <= b.end; i++) toRemove.add(i);
  if (lineIsBlank(b.start - 1) && b.end + 1 < fromLines.length && lineIsBlank(b.end + 1)) {
    toRemove.add(b.end + 1);
  }
}
const kept = fromLines.filter((_, i) => !toRemove.has(i));
const fromOut = kept.join(fromEol) + (fromEndsWithEol ? fromEol : '');

// Append to the destination.
let toEol = fromEol;
let toText = '';
if (fs.existsSync(toFile)) {
  toText = fs.readFileSync(toFile, 'utf8');
  toEol = toText.includes('\r\n') ? '\r\n' : '\n';
  if (toText.length > 0 && !toText.endsWith('\n')) toText += toEol;
  if (toText.length > 0 && !/(\r?\n){2}$/.test(toText)) toText += toEol;
}
toText += appended.join(toEol) + toEol;

fs.writeFileSync(toFile, toText);
fs.writeFileSync(fromFile, fromOut);
console.log(`moved ${blocks.length} blocks: ${fromFile} -> ${toFile}`);
