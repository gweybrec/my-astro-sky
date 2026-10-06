// Landscape variant of a portrait artboard: recipe hunks (derived from the reviewer's files) applied on the portrait tokens.
import fs from "fs";
export const ROOT = '<div id="root"';
export function split(s) { const a = s.indexOf(ROOT), b = s.indexOf("</x-dc>"); return { head: s.slice(0, a), body: s.slice(a, b), tail: s.slice(b) }; }
const BOOL = /(\s)(checked|disabled|selected|readonly|hidden|required|multiple|autofocus)(?=[\s>\/])(?!=)/g;
export const norm = (s) =>
  s.replace(/style="([^"]*)"/g, (m, v) => 'style="' + v.split(";").map((x) => x.trim().replace(/\s*:\s*/, ":").replace(/,\s+/g, ",").replace(/\s+/g, " ")).filter(Boolean).join(";") + '"')
    .replace(/(\s)(checked|disabled|selected|readonly|hidden|required|multiple|autofocus)=""/g, "$1$2").replace(/ \/>/g, ">");
export const tok = (s) => s.split(/(?=<)/);
export const boolFix = (s) => s.replace(BOOL, '$1$2=""');
export function derive(portrait, land) {
  const A = tok(split(portrait).body), B = tok(split(land).body);
  const NA = A.map(norm), NB = B.map(norm);
  const m = A.length, k = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(k + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) dp[i][j] = NA[i] === NB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < m || j < k) {
    if (i < m && j < k && NA[i] === NB[j]) { flush(); i++; j++; }
    else {
      if (!cur) cur = { at: i, before: NA.slice(Math.max(0, i - 3), i), old: [], neu: [] };
      if (j < k && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { cur.neu.push(B[j]); j++; } else { cur.old.push(NA[i]); i++; }
    }
  }
  flush();
  for (const h of hunks) h.after = NA.slice(h.at + h.old.length, h.at + h.old.length + 3);
  return hunks;
}
// apply: returns {out, missed}
export function apply(portrait, hunks, { width = 915, height = 412, titleSuffix = ", paysage" } = {}) {
  const { head, body, tail } = split(portrait);
  const T = tok(body), N = T.map(norm);
  const res = []; let pos = 0; const missed = [];
  for (const h of hunks) {
    let found = -1;
    for (let p = pos; p <= N.length; p++) {
      let ok = true;
      for (let q = 0; q < h.old.length && ok; q++) if (N[p + q] !== h.old[q]) ok = false;
      for (let q = 0; q < h.before.length && ok; q++) if (N[p - h.before.length + q] !== h.before[q]) ok = false;
      for (let q = 0; q < h.after.length && ok; q++) if (h.after[q] !== undefined && N[p + h.old.length + q] !== h.after[q]) ok = false;
      if (ok && p - h.before.length >= 0) { found = p; break; }
    }
    if (found < 0 && h.old.length) { for (let p = pos; p + h.old.length <= N.length && found < 0; p++) { let ok = true; for (let q = 0; q < h.old.length && ok; q++) if (N[p + q] !== h.old[q]) ok = false; if (ok) found = p; } }
    if (found < 0) { missed.push(h); continue; }
    for (let q = pos; q < found; q++) res.push(boolFix(T[q]));
    for (const t of h.neu) res.push(t);
    pos = found + h.old.length;
  }
  for (let q = pos; q < T.length; q++) res.push(boolFix(T[q]));
  let nh = head.replace(/<title>(.*?)<\/title>/, (m, t) => `<title>${t}${titleSuffix}</title>`).replace('components/bundle.css">\n</head>', 'components/bundle.css">\n<link rel="stylesheet" href="../tools/landscape.css">\n</head>');
  let nt = tail.replace(/data-props='\{"\$preview":\{"width":\d+,"height":\d+\}\}'/, `data-props='{"$preview":{"width":${width},"height":${height}}}'`);
  nt = boolFix(nt);
  return { out: nh + res.join("") + nt, missed };
}
