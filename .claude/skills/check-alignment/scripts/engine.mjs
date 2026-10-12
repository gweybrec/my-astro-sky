// The measuring engine of the alignment check. It knows nothing about any app: it receives RULES (data: a type and
// selectors) and measures them in a page, one generic function per type. Rules files are in `../rules/`.
//
// A measurement is { rule, a, b, axis, aPos, bPos, value, kind }: element `a` against reference `b` along `axis`
// ('x' or 'y'); value = aPos - bPos. kind 'abs' fails when |value| is above the tolerance, kind 'min' (a gap that
// must be at least a given size) when value is below minus the tolerance.
/* global document, window, getComputedStyle, NodeFilter, innerWidth */

export const TOLERANCE = 0.5;

/**
 * Runs in the page. `scopeSel` limits the measurement to one element (an open sheet); without it everything outside
 * a closed modal is measured. Returns { found, missingScope }. The elements stay in `window.__align` for a crop.
 */
export function measureInPage([rules, scopeSel]) {
  const found = [];
  const els = [];
  const root = scopeSel ? document.querySelector(scopeSel) : document;
  if (!root) return { found, missingScope: true };
  const R = (el) => el.getBoundingClientRect();
  const all = (sel, from = root) => [...from.querySelectorAll(sel)];
  const shown = (el) => {
    const r = R(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      !el.closest('[hidden]') &&
      (scopeSel !== undefined && scopeSel !== null ? true : !el.closest('ion-modal'))
    );
  };
  const num = (v) => parseFloat(v) || 0;
  const label = (el) => {
    if (!el) return '';
    const text = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 26);
    if (text) return `"${text}"`;
    const cls = [...el.classList][0];
    if (el.tagName.toLowerCase() === 'svg') return 'icon';
    return cls ? cls.replace(/^mob-/, '') : el.tagName.toLowerCase();
  };
  const add = (rule, a, b, axis, aPos, bPos, marks) => {
    found.push({
      rule: rule.id,
      a: label(a),
      b: label(b),
      axis,
      aPos,
      bPos,
      value: aPos - bPos,
      kind: rule.minimum ? 'min' : 'abs',
      marks: marks ?? [aPos, bPos],
    });
    els.push([a, b]);
  };
  const centreY = (el) => (R(el).top + R(el).bottom) / 2;
  const centreX = (el) => (R(el).left + R(el).right) / 2;
  const trackOf = (row, rule) =>
    rule.track
      ? (row.shadowRoot?.querySelector(rule.track) ?? row.querySelector(rule.track))
      : null;
  const length = (css) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:${css}`;
    document.body.appendChild(probe);
    const w = R(probe).width;
    probe.remove();
    return w;
  };
  // The bottom of the text's baseline. The probe goes at the end of the element's own text. In a flex host (a chip)
  // it would become a flex item of its own, so the text is wrapped in a temporary span and the probe sits inside it.
  const baselineOf = (el) => {
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
  const rowBox = (row) => {
    const r = R(row);
    const cs = getComputedStyle(row);
    return { top: r.top + num(cs.borderTopWidth), bottom: r.bottom - num(cs.borderBottomWidth) };
  };

  const types = {
    // The text and the text inside a chip of the same line share a baseline.
    baseline(rule) {
      for (const line of all(rule.lines)) {
        const kids = [...line.children].filter((k) => R(k).width > 0);
        const plain = kids.filter((k) => !k.matches(rule.chips));
        const chips = kids.filter((k) => k.matches(rule.chips));
        if (!plain.length || !chips.length) continue;
        const reference = baselineOf(plain[0]);
        if (reference === null) continue;
        for (const chip of chips) {
          const b = baselineOf(chip);
          if (b !== null) add(rule, chip, plain[0], 'y', b, reference);
        }
      }
    },
    // Icon-like items (and the switch's track) are centred on their row's height.
    rowCentre(rule) {
      for (const row of all(rule.rows)) {
        if (!shown(row)) continue;
        const { top, bottom } = rowBox(row);
        const items = all(rule.items, row).filter((e) => R(e).width > 0);
        const t = trackOf(row, rule);
        if (t) items.push(t);
        for (const item of items) add(rule, item, row, 'y', centreY(item), (top + bottom) / 2);
      }
    },
    // The content of a row has the same room above and below.
    room(rule) {
      for (const row of all(rule.rows)) {
        if (!shown(row)) continue;
        const { top, bottom } = rowBox(row);
        const t = trackOf(row, rule);
        const boxes = all('*', row)
          .filter((e) => {
            const style = getComputedStyle(e);
            return R(e).height > 0 && style.position !== 'absolute' && style.display !== 'contents';
          })
          .map(R);
        if (t) boxes.push(R(t));
        if (!boxes.length) continue;
        const first = Math.min(...boxes.map((b) => b.top));
        const last = Math.max(...boxes.map((b) => b.bottom));
        add(rule, row, null, 'y', first - top, bottom - last, [top, first, last, bottom]);
      }
    },
    // An icon alone in its box is centred in it, on both axes.
    boxCentre(rule) {
      for (const box of all(rule.boxes)) {
        const icon = box.querySelector(rule.icon);
        if (!icon || !shown(box) || (box.textContent || '').trim()) continue;
        add(rule, icon, box, 'x', centreX(icon), centreX(box));
        add(rule, icon, box, 'y', centreY(icon), centreY(box));
      }
    },
    // An icon that follows a text on the same line is centred on the line.
    iconOnLine(rule) {
      for (const line of all(rule.lines)) {
        const icon = line.querySelector(rule.icon);
        if (icon && shown(line)) add(rule, icon, line, 'y', centreY(icon), centreY(line));
      }
    },
    // Items side by side in a bar share their centre line (children of `bars`; the largest spread is reported).
    centreLine(rule) {
      for (const bar of all(rule.bars)) {
        if (!shown(bar)) continue;
        const kids = [...bar.querySelectorAll(rule.children ?? ':scope > *')].filter(
          (k) => R(k).width > 0 && R(k).height > 0,
        );
        if (kids.length < 2) continue;
        const sorted = [...kids].sort((x, y) => centreY(x) - centreY(y));
        const high = sorted[0];
        const low = sorted[sorted.length - 1];
        add(rule, low, high, 'y', centreY(low), centreY(high));
      }
    },
    // The buttons of a bar start on the same line (or column, when the bar is a column).
    sameStart(rule) {
      for (const bar of all(rule.bars)) {
        if (!shown(bar)) continue;
        const buttons = all(rule.children, bar).filter((k) => R(k).width > 0);
        if (buttons.length < 2) continue;
        const key = getComputedStyle(bar).flexDirection === 'row' ? 'top' : 'left';
        for (const b of buttons.slice(1)) {
          add(rule, b, buttons[0], key === 'top' ? 'y' : 'x', R(b)[key], R(buttons[0])[key]);
        }
      }
    },
    // The space between two neighbours (`first`, then `second` or the switch's track) is at least `gap`.
    gap(rule) {
      const token = length(rule.gap);
      for (const row of all(rule.rows)) {
        if (!shown(row)) continue;
        const first = row.querySelector(rule.first);
        const second = rule.second ? row.querySelector(rule.second) : trackOf(row, rule);
        if (first && second) {
          add(rule, second, first, 'x', R(second).left, R(first).right + token);
        }
      }
    },
    // Text starts of the page's items are stacked on one line (only the first column: a second column of a landscape
    // page starts a whole column further).
    leadingEdge(rule) {
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
      for (const el of all(rule.items)) {
        const x = shown(el) ? textLeft(el) : null;
        if (x !== null) lefts.push([el, x]);
      }
      if (!lefts.length) return;
      const lo = lefts.reduce((m, l) => (l[1] < m[1] ? l : m));
      for (const [el, x] of lefts) {
        if (x - lo[1] < innerWidth / 4) add(rule, el, lo[0], 'x', x, lo[1]);
      }
    },
    // The trailing control of each row (`end`, else the switch's track) ends on one line.
    trailingEdge(rule) {
      const ends = [];
      for (const row of all(rule.rows)) {
        if (!shown(row) || (rule.skip && row.closest(rule.skip))) continue;
        const el = (rule.end && row.querySelector(rule.end)) ?? trackOf(row, rule);
        if (el && R(el).width > 0) ends.push([el, R(el).right]);
      }
      if (!ends.length) return;
      const hi = ends.reduce((m, l) => (l[1] > m[1] ? l : m));
      for (const [el, x] of ends) add(rule, el, hi[0], 'x', x, hi[1]);
    },
    // Inside each container (`within`), the matched boxes share one left edge (`lefts`) and one right edge (`rights`).
    edges(rule) {
      for (const container of all(rule.within)) {
        if (!shown(container)) continue;
        for (const side of ['left', 'right']) {
          const selector = side === 'left' ? rule.lefts : rule.rights;
          if (!selector) continue;
          const items = all(selector, container).filter((e) => R(e).width > 0 && shown(e));
          if (items.length < 2) continue;
          const pick = side === 'left' ? Math.min : Math.max;
          const reference = pick(...items.map((e) => R(e)[side]));
          const refItem = items.find((e) => R(e)[side] === reference);
          for (const item of items) add(rule, item, refItem, 'x', R(item)[side], reference);
        }
      }
    },
    // The gaps between neighbours of a bar (a row, or a column) are all equal.
    equalGaps(rule) {
      for (const bar of all(rule.bars)) {
        if (!shown(bar)) continue;
        const kids = [...bar.children].filter((k) => R(k).width > 0 && R(k).height > 0);
        if (kids.length < 3) continue;
        const column = getComputedStyle(bar).flexDirection === 'column';
        const start = column ? 'top' : 'left';
        const end = column ? 'bottom' : 'right';
        const gaps = kids.slice(1).map((k, i) => R(k)[start] - R(kids[i])[end]);
        const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        kids.slice(1).forEach((k, i) => {
          add(rule, k, kids[i], column ? 'y' : 'x', gaps[i], median);
        });
      }
    },
    // The children of an empty state are centred in it.
    centredBlock(rule) {
      for (const box of all(rule.boxes)) {
        if (!shown(box)) continue;
        for (const k of box.children) {
          if (R(k).width > 0) add(rule, k, box, 'x', centreX(k), centreX(box));
        }
      }
    },
  };

  for (const rule of rules) {
    if (!types[rule.type]) throw new Error(`unknown rule type "${rule.type}" (rule ${rule.id})`);
    types[rule.type](rule);
  }
  window.__align = els;
  return { found, missingScope: false };
}

/** Emulates Android's font-size setting: every text's size and fixed line height are multiplied, boxes are not. */
export function scaleText(factor) {
  const everything = [...document.querySelectorAll('body *')];
  const sizes = everything.map((el) => {
    const cs = getComputedStyle(el);
    return [
      parseFloat(cs.fontSize),
      cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : null,
    ];
  });
  everything.forEach((el, i) => {
    el.style.setProperty('font-size', `${sizes[i][0] * factor}px`, 'important');
    if (sizes[i][1] !== null) {
      el.style.setProperty('line-height', `${sizes[i][1] * factor}px`, 'important');
    }
  });
}

/** Runs a view's actions, described as data: { click } or { fill, text } (a selector), { wait } (a selector) or { pause } (milliseconds). */
export async function runActions(page, actions = []) {
  for (const action of actions) {
    if (action.click) await page.locator(action.click).first().click({ timeout: 10000 });
    else if (action.fill)
      await page
        .locator(action.fill)
        .first()
        .fill(action.text ?? '', { timeout: 10000 });
    else if (action.wait) await page.waitForSelector(action.wait, { timeout: 15000 });
    else if (action.pause) await page.waitForTimeout(action.pause);
  }
}

/** Waits until an element stops moving (a sheet slides in). */
export async function waitStill(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const key = JSON.stringify(el.getBoundingClientRect());
      const previous = window.__still;
      window.__still = key;
      return previous === key;
    },
    selector,
    { polling: 120, timeout: 10000 },
  );
}

export const isBad = (m) => (m.kind === 'min' ? -m.value : Math.abs(m.value)) > TOLERANCE;
export const figureOf = (m) => (m.kind === 'min' ? Math.max(0, -m.value) : Math.abs(m.value));

/** "7.0 px lower", "4.0 px to the right", "3.0 px too close". */
export function describe(m) {
  const px = `${figureOf(m).toFixed(1)} px`;
  if (m.kind === 'min') return `${px} too close`;
  if (m.axis === 'y') return `${px} ${m.value > 0 ? 'lower' : 'higher'}`;
  return `${px} ${m.value > 0 ? 'to the right' : 'to the left'}`;
}

/**
 * Saves one enlarged picture of the n-th failing measurement (1-based) of the page as it is now, with the measured
 * positions drawn as 1 px coloured lines. Returns the path, or null when there is no such failure.
 */
export async function cropFailure(page, n, file) {
  const info = await page.evaluate((index) => {
    const els = window.__align ?? [];
    const meta = window.__alignFound ?? [];
    const bad = meta.map((m, i) => [m, i]).filter(([m]) => m.bad);
    const pick = bad[index - 1];
    if (!pick) return null;
    const [m, i] = pick;
    const rects = (els[i] ?? []).filter(Boolean).map((e) => e.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const colours = ['#ff2d55', '#00e5ff', '#ffd400', '#7CFC00'];
    m.marks.forEach((pos, k) => {
      const line = document.createElement('div');
      const colour = colours[k % colours.length];
      line.style.cssText =
        m.axis === 'y'
          ? `position:absolute;left:0;right:0;top:${pos}px;height:1px;background:${colour}`
          : `position:absolute;top:0;bottom:0;left:${pos}px;width:1px;background:${colour}`;
      layer.appendChild(line);
    });
    document.body.appendChild(layer);
    return { left, top, right, bottom };
  }, n);
  if (!info) return null;
  const pad = 24;
  const clip = {
    x: Math.max(0, info.left - pad),
    y: Math.max(0, info.top - pad),
    width: Math.max(8, info.right - info.left + 2 * pad),
    height: Math.max(8, info.bottom - info.top + 2 * pad),
  };
  await page.screenshot({ path: file, clip });
  return file;
}
