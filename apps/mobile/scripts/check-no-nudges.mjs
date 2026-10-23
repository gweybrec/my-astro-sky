// Static check, no browser: the phone app aligns by layout (flex, grid, baselines, tokens), never by pixel offsets.
// Scans the CSS files and the style blocks / inline styles of the .vue files of apps/mobile/src for a literal length in
// the properties that are used to nudge an item, and fails on any hit that is not in ALLOWED below.
// Usage: node apps/mobile/scripts/check-no-nudges.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

// A length written as a number: 4px, -0.5rem, 50%, 2em. `0` alone is not a length. A length inside `var(--x, 4px)`
// fallback counts too.
const LITERAL = /(?<![\w.-])-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|dvh|svh)(?![\w%])/;
// Not offsets: a zero, and "the whole of the parent or of the screen".
const NEUTRAL = /(?<![\w.-])(0(px|rem|em|%)?|100(%|dvh|vh|vw))(?![\w.%-])/g;
const PROPS = new RegExp(
  '^(top|bottom|left|right|inset|inset-[a-z-]+|margin|margin-[a-z-]+|padding|padding-[a-z-]+|height|min-height|max-height|line-height|vertical-align|translate|transform|transform-origin|gap|row-gap|column-gap)$',
);

/**
 * Each entry: file (relative to apps/mobile/src), a text the offending declaration's rule/selector must contain, the
 * property, and why it is not a nudge. Anything else with a literal length fails.
 */
const ALLOWED = [];

/**
 * Folders that are not scanned, with the reason. The design system's stylesheet is the mockups' CSS taken as it is; the
 * app overrides, in phone-components.css, the few of its footprint hacks it uses (a negative margin on the chevron and
 * the caret, a `vertical-align` length on a fact's icon). Its other lengths are sizes of its own elements, the
 * typographic line heights of its text styles, and centring overlays (`top: 50%` with a translate on a pseudo-element).
 */
const NOT_SCANNED = ['theme/design-system/'];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(css|vue)$/.test(e.name) ? [p] : [];
  });
}

/** Declarations of a CSS text: { selector, prop, value, line }. */
function declarations(text, firstLine) {
  const out = [];
  const stack = [];
  let buf = '';
  let line = firstLine;
  let declLine = line;
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const ch of clean) {
    if (ch === '\n') line += 1;
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      const m = buf.match(/^\s*([a-z-]+)\s*:\s*([\s\S]+)$/);
      if (m)
        out.push({ selector: stack.join(' { '), prop: m[1], value: m[2].trim(), line: declLine });
      buf = '';
    } else {
      if (!buf.trim()) declLine = line;
      buf += ch;
    }
  }
  return out;
}

const hits = [];
for (const file of files(src)) {
  const rel = path.relative(src, file).split(path.sep).join('/');
  if (NOT_SCANNED.some((dir) => rel.startsWith(dir))) continue;
  const text = readFileSync(file, 'utf8');
  const blocks = [];
  if (file.endsWith('.css')) blocks.push({ css: text, line: 1 });
  else {
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      blocks.push({ css: m[1], line: text.slice(0, m.index).split('\n').length });
    }
    for (const m of text.matchAll(/\sstyle="([^"]*)"/g)) {
      blocks.push({ css: `[inline]{${m[1]};}`, line: text.slice(0, m.index).split('\n').length });
    }
  }
  for (const b of blocks) {
    for (const d of declarations(b.css, b.line)) {
      if (!PROPS.test(d.prop)) continue;
      const bad =
        d.prop === 'transform' || d.prop === 'translate'
          ? /translate/.test(d.value) && LITERAL.test(d.value.replace(NEUTRAL, ''))
          : LITERAL.test(d.value.replace(NEUTRAL, ''));
      if (!bad) continue;
      const allowed = ALLOWED.some(
        (a) => a.file === rel && a.prop === d.prop && d.selector.includes(a.selector),
      );
      if (!allowed) hits.push(`${rel}:${d.line}  ${d.selector}  ${d.prop}: ${d.value}`);
    }
  }
}
if (hits.length) {
  console.error(
    'Pixel offsets in the phone app (align by layout instead, or allow-list with a reason):',
  );
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('No pixel nudges in apps/mobile/src.');
