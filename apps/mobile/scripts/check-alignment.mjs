// Checks, in the rendered dev gallery (`/dev/components`), that the phone app aligns by layout: every figure below must
// be within 0.5 px. Needs `npm run mobile:dev` running (port 5174, or BASE_URL) and an installed browser
// (BROWSER_CHANNEL, default msedge); it downloads nothing. Prints each offending element and its figure, exits 1 on any.
//
//   text and the text inside a chip or badge of the same row share a baseline        (rule "baseline")
//   an icon, a switch or an "i" button is centred on its row                          (rule "icon-centre")
//   a row's content has the same room above and below                                 (rule "room")
//   leading edges of the texts and trailing edges of the controls of a page are stacked (rules "left-edge", "right-edge")
//   an icon alone in its box is centred in it                                         (rule "box-centre")
//   an icon after a text is centred on the text's line                                (rule "icon-text")
//   items side by side in a bar, a footer, a field row share their centre line        (rule "centre-line")
//   an "i" button and the switch beside it are apart by at least the token gap       (rule "gap")
//   an empty state's content is centred on the screen                                 (rule "centred")
// The same measurements are repeated at 384 x 832, 412 x 915 and 832 x 384, in the four languages, and with the text
// scaled to 130 % (Android's font-size setting scales text, not boxes).
// Usage: node apps/mobile/scripts/check-alignment.mjs   (EXTRA_CSS="..." adds a style sheet, to see that a defect is caught;
//                                                     --boards <folder> also prints the mockups' own figures)
/* global document, getComputedStyle, NodeFilter, innerWidth */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let chromium;
for (const c of [path.join(root, 'package.json'), path.join(root, 'spikes/mobile/package.json')]) {
  try {
    if (!existsSync(c)) continue;
    ({ chromium } = createRequire(c)('playwright-core'));
    break;
  } catch {
    /* try the next place */
  }
}
if (!chromium) {
  console.error('playwright-core not found (looked in the repository and spikes/mobile).');
  process.exit(2);
}

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const TOLERANCE = 0.5;
const SIZES = [
  [384, 832],
  [412, 915],
  [832, 384],
];
const LANGS = ['fr', 'en', 'es', 'de'];
const ZOOMS = [1, 1.3];

/** Runs in the page. Returns [{ rule, where, value, kind }] for every measurement taken. */
function measure(board) {
  // On a board (the mockup's plain HTML) rows, switch and chips are plain elements; in the app they are Ionic's.
  const found = [];
  const add = (rule, where, value, kind = 'abs') => found.push({ rule, where, value, kind });
  const R = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = R(el);
    return r.width > 0 && r.height > 0 && !el.closest('ion-modal, [hidden]');
  };
  const label = (el) => {
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${text}"`;
  };
  const num = (v) => parseFloat(v) || 0;

  // ── baseline ───────────────────────────────────────────────────────────────────────────────────────
  // The probe goes at the end of the element's own text. In a flex host (a chip) it would become a flex item of its
  // own, so the text is wrapped in a temporary span first and the probe sits inside that span.
  const baseline = (el) => {
    const text = [...el.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) return null;
    const wrap = document.createElement('span');
    text.replaceWith(wrap);
    wrap.appendChild(text);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    wrap.appendChild(probe);
    const bottom = R(probe).bottom;
    wrap.replaceWith(text);
    return bottom;
  };
  const isChip = (el) =>
    /^ION-(BADGE|CHIP)$/.test(el.tagName) ||
    el.classList.contains('mob-badge') ||
    el.classList.contains('mob-chip');
  for (const row of document.querySelectorAll('.mob-meta')) {
    const kids = [...row.children].filter((k) => R(k).width > 0);
    const plain = kids.filter((k) => !isChip(k));
    const chips = kids.filter(isChip);
    if (!plain.length || !chips.length) continue;
    const reference = baseline(plain[0]);
    if (reference === null) continue;
    for (const chip of chips) {
      const b = baseline(chip);
      if (b !== null) add('baseline', `${label(plain[0])} / ${label(chip)}`, b - reference);
    }
  }

  // ── rows: the icon-like items centred on the row, the room above and below ─────────────────────────
  const ROWS = board
    ? '.mob-row, .mob-entry'
    : 'ion-item.mob-row, ion-toggle.mob-row, ion-radio.mob-row, ion-checkbox.mob-row, .mob-entry';
  const ICONS = [
    '.mob-row-lead',
    '.mob-row-chevron',
    '.mob-drag svg',
    '.mob-btn-caret',
    '.mob-icon-btn',
    '.mob-check',
  ].join(', ');
  const track = (row) =>
    board
      ? row.querySelector('.mob-switch')
      : row.shadowRoot?.querySelector('.toggle-icon-wrapper, .native-wrapper');
  for (const row of document.querySelectorAll(ROWS)) {
    if (!visible(row)) continue;
    const r = R(row);
    const cs = getComputedStyle(row);
    const top = r.top + num(cs.borderTopWidth);
    const bottom = r.bottom - num(cs.borderBottomWidth);
    const centre = (top + bottom) / 2;
    const items = [...row.querySelectorAll(ICONS)].filter((e) => R(e).width > 0);
    const t = track(row);
    if (t) items.push(t);
    for (const item of items) {
      const b = R(item);
      add('icon-centre', `${label(row)} > ${label(item)}`, (b.top + b.bottom) / 2 - centre);
    }
    // The room above and below the content (every visible descendant that takes part in the layout).
    const boxes = [...row.querySelectorAll('*')]
      .filter((e) => {
        const style = getComputedStyle(e);
        return R(e).height > 0 && style.position !== 'absolute' && style.display !== 'contents';
      })
      .map(R);
    if (t) boxes.push(R(t));
    if (boxes.length) {
      const above = Math.min(...boxes.map((b) => b.top)) - top;
      const below = bottom - Math.max(...boxes.map((b) => b.bottom));
      add('room', label(row), above - below);
    }
  }

  // ── an icon alone in its box is centred in it, on both axes ────────────────────────────────────────
  for (const box of document.querySelectorAll(
    '.mob-drag, .mob-icon-btn, .mob-fab, ion-fab-button, .mob-btn--icon',
  )) {
    const svg = box.querySelector('svg');
    if (!svg || !visible(box) || (box.textContent || '').trim()) continue;
    const b = R(box);
    const i = R(svg);
    add('box-centre', `${label(box)} x`, (i.left + i.right) / 2 - (b.left + b.right) / 2);
    add('box-centre', `${label(box)} y`, (i.top + i.bottom) / 2 - (b.top + b.bottom) / 2);
  }

  // ── an icon that follows a text on the same line is centred on the text's line ─────────────────────
  for (const value of document.querySelectorAll('.mob-fact-value')) {
    const svg = value.querySelector('svg');
    if (!svg || !visible(value)) continue;
    const line = R(value);
    const i = R(svg);
    add('icon-text', label(value), (i.top + i.bottom) / 2 - (line.top + line.bottom) / 2);
  }

  // ── centre line of items side by side ──────────────────────────────────────────────────────────────
  const LINES =
    '.mob-topbar, .mob-sheet-footer, .mob-footer, .mob-input-row, .phone-field-unit-line';
  for (const bar of document.querySelectorAll(LINES)) {
    if (!visible(bar)) continue;
    const kids = [...bar.children].filter((k) => R(k).width > 0 && R(k).height > 0);
    if (kids.length < 2) continue;
    const centreOf = (k) => (R(k).top + R(k).bottom) / 2;
    const centres = kids.map(centreOf);
    add('centre-line', label(bar), Math.max(...centres) - Math.min(...centres));
  }

  // ── an "i" button and the switch beside it ─────────────────────────────────────────────────────────
  const gapToken = (() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--space-4)';
    document.body.appendChild(probe);
    const w = R(probe).width;
    probe.remove();
    return w;
  })();
  for (const row of document.querySelectorAll(
    board ? '.mob-row--info' : 'ion-toggle.mob-toggle-row--info',
  )) {
    if (!visible(row)) continue;
    const info = row.querySelector('.mob-icon-btn');
    const t = track(row);
    if (info && t) add('gap', label(row), R(t).left - R(info).right - gapToken, 'min');
  }

  // ── stacked edges ──────────────────────────────────────────────────────────────────────────────────
  const textLeft = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.trim()) node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects()[0].left;
  };
  const lefts = [];
  for (const el of document.querySelectorAll(
    board
      ? '.mob-section-header, .mob-helper, .mob-row:not(:has(.mob-row-lead)):not(.mob-entry .mob-row) .mob-row-title'
      : '.mob-section-header, .mob-form-label, .mob-helper, ion-item.mob-row:not(:has(.mob-row-lead)):not(.mob-entry .mob-row) .mob-row-title, ion-toggle.mob-row .mob-row-title',
  )) {
    const x = visible(el) ? textLeft(el) : null;
    if (x !== null) lefts.push([label(el), x]);
  }
  if (lefts.length) {
    const lo = Math.min(...lefts.map((l) => l[1]));
    // Only the first column: a second column of a landscape page starts a whole column further.
    for (const [name, x] of lefts) if (x - lo < innerWidth / 4) add('left-edge', name, x - lo);
  }
  const rights = [];
  for (const row of document.querySelectorAll(
    board ? '.mob-row' : 'ion-item.mob-row, ion-toggle.mob-row',
  )) {
    if (!visible(row) || row.closest('.mob-entry')) continue;
    const end = row.querySelector('.mob-row-chevron');
    const t = track(row);
    const el = end ?? t;
    if (el && R(el).width > 0) rights.push([label(row), R(el).right]);
  }
  if (rights.length) {
    const hi = Math.max(...rights.map((l) => l[1]));
    for (const [name, x] of rights) add('right-edge', name, hi - x);
  }

  // ── an empty state is centred ──────────────────────────────────────────────────────────────────────
  for (const box of document.querySelectorAll('.mob-empty')) {
    if (!visible(box)) continue;
    const b = R(box);
    for (const k of box.children) {
      const r = R(k);
      if (r.width > 0) {
        add(
          'centred',
          `${label(box)} > ${label(k)}`,
          (r.left + r.right) / 2 - (b.left + b.right) / 2,
        );
      }
    }
  }

  // ── a tab bar's buttons share a line ───────────────────────────────────────────────────────────────
  for (const bar of document.querySelectorAll('ion-tab-bar')) {
    if (!visible(bar)) continue;
    const buttons = [...bar.querySelectorAll('ion-tab-button')];
    const axis = getComputedStyle(bar).flexDirection === 'row' ? 'top' : 'left';
    const first = R(buttons[0])[axis];
    for (const b of buttons) add('centre-line', `${label(b)} (tab)`, R(b)[axis] - first);
  }
  return found;
}

/** Emulates Android's font-size setting: every text's size and fixed line height are multiplied, boxes are not. */
function scaleText(factor) {
  const all = [...document.querySelectorAll('body *')];
  const sizes = all.map((el) => {
    const cs = getComputedStyle(el);
    return [
      parseFloat(cs.fontSize),
      cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : null,
    ];
  });
  all.forEach((el, i) => {
    el.style.setProperty('font-size', `${sizes[i][0] * factor}px`, 'important');
    if (sizes[i][1] !== null) {
      el.style.setProperty('line-height', `${sizes[i][1] * factor}px`, 'important');
    }
  });
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true });
const failures = [];
let taken = 0;
const worst = {};
try {
  for (const [width, height] of SIZES) {
    for (const lang of LANGS) {
      for (const zoom of ZOOMS) {
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addInitScript((l) => {
          try {
            localStorage.setItem('lang', l);
          } catch {
            /* the page then starts in French */
          }
        }, lang);
        const page = await context.newPage();
        await page.goto(`${BASE}/dev/components`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.mob-meta ion-badge');
        await page.waitForTimeout(500);
        if (process.env.EXTRA_CSS) await page.addStyleTag({ content: process.env.EXTRA_CSS });
        if (zoom !== 1) await page.evaluate(scaleText, zoom);
        const where = `${width}x${height} ${lang} text x${zoom}`;
        for (const f of await page.evaluate(measure, false)) {
          taken += 1;
          const bad = f.kind === 'min' ? f.value < 0 : Math.abs(f.value) > TOLERANCE;
          const figure = f.kind === 'min' ? Math.max(0, -f.value) : Math.abs(f.value);
          worst[f.rule] = Math.max(worst[f.rule] ?? 0, figure);
          if (bad)
            failures.push(`${f.rule.padEnd(11)} ${where}  ${f.where}  ${f.value.toFixed(2)} px`);
        }
        await context.close();
      }
    }
  }
  // Optional: the mockups' own figures, to know what "aligned" means for each rule. `--boards <folder>` names a local
  // folder of mockups (`<Name>.dc.html`, `<Name>Landscape.dc.html`); without it this step is skipped.
  const boardsAt = process.argv.includes('--boards')
    ? process.argv[process.argv.indexOf('--boards') + 1]
    : null;
  if (!boardsAt || !existsSync(boardsAt)) {
    console.log('Boards not measured (pass --boards <folder of mockups> to compare with them).');
  } else {
    for (const [width, height, suffix] of [
      [412, 915, ''],
      [915, 412, 'Landscape'],
    ]) {
      for (const name of [
        'Targets',
        'PlanDetail',
        'PlanEntry',
        'ObsWindow',
        'Settings',
        'Backup',
      ]) {
        const file = path.join(boardsAt, `${name}${suffix}.dc.html`);
        if (!existsSync(file)) continue;
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
        await page.waitForTimeout(1000);
        const byRule = {};
        for (const f of await page.evaluate(measure, true)) {
          byRule[f.rule] = Math.max(byRule[f.rule] ?? 0, Math.abs(f.value));
        }
        const figures = Object.entries(byRule).map(([r, v]) => `${r} ${v.toFixed(2)}`);
        console.log(`board ${name}${suffix} ${width}x${height}: ${figures.join(', ')}`);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${taken} measurements; largest figure per rule (px):`);
for (const [rule, v] of Object.entries(worst)) console.log(`  ${rule.padEnd(12)} ${v.toFixed(2)}`);
if (failures.length === 0) {
  console.log('All within 0.5 px.');
  process.exit(0);
}
const unique = [...new Set(failures)];
console.error(`${unique.length} offending measurement(s):`);
for (const f of unique.slice(0, 80)) console.error('  ' + f);
process.exit(1);
