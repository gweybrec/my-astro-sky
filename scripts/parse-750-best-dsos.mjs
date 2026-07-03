#!/usr/bin/env node
// Parses The-750-Best-DSOs-Imm-2024-Rev1.pdf and outputs scripts/data-750-best-dsos.json
// Output: { "M42": 5, "NGC7000": 4, "SH2-240": 5, ... }  (imaging score 1–5)

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, '..', 'The-750-Best-DSOs-Imm-2024-Rev1.pdf');
const OUT_PATH = path.join(__dirname, 'data-750-best-dsos.json');

// Catalog prefixes that are followed by a second token (e.g. "NGC 1234")
const TWO_TOKEN_PREFIXES = new Set([
  'NGC',
  'IC',
  'M',
  'LDN',
  'LBN',
  'Abell',
  'Melotte',
  'HDW',
  'Cederblad',
  'Barnard',
  'vdB',
]);

// Normalize a parsed object name to the catalog ID used in dso.json
function normalizeName(name) {
  name = name.trim();

  if (/^M\s*(\d+)$/.test(name)) {
    return 'M' + parseInt(name.replace(/^M\s*/, ''));
  }
  if (/^NGC\s*(\d+)$/.test(name)) {
    return 'NGC' + parseInt(name.replace(/^NGC\s*/, ''));
  }
  if (/^IC\s*(\d+)$/.test(name)) {
    return 'IC' + parseInt(name.replace(/^IC\s*/, ''));
  }
  if (/^Sh2-(\d+)$/i.test(name)) {
    return 'SH2-' + parseInt(name.replace(/^Sh2-/i, ''));
  }
  if (/^LDN\s*(\d+)$/.test(name)) {
    return 'LDN' + parseInt(name.replace(/^LDN\s*/, ''));
  }
  if (/^LBN\s*(\d+)$/.test(name)) {
    return 'LBN' + parseInt(name.replace(/^LBN\s*/, ''));
  }
  if (/^vdB\s*(\d+)$/i.test(name)) {
    return 'vdB' + parseInt(name.replace(/^vdB\s*/i, ''));
  }

  // Skip: Abell (galaxy clusters/faint PNe), Melotte (OCs), HDW, Cederblad, Barnard
  return null;
}

// Extract text from the PDF
let text;
try {
  text = execSync(`pdftotext -layout "${PDF_PATH}" -`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
} catch (e) {
  console.error('pdftotext failed:', e.message);
  process.exit(1);
}

const lines = text.split('\n');
const result = {};
let parsed = 0;
let skipped = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Data rows start with 1–3 digits followed by whitespace and an uppercase letter
  const rowStartMatch = line.match(/^(\d{1,3})\s+([A-Za-z][A-Za-z0-9-]*)(.*)$/);
  if (!rowStartMatch) continue;

  const rowNum = parseInt(rowStartMatch[1]);
  if (rowNum < 1 || rowNum > 750) continue;

  // Parse the first token of the object name
  const firstToken = rowStartMatch[2];
  let rest = rowStartMatch[3];
  let objectName = firstToken;

  // Check if this is a two-token name (e.g. "NGC 1300", "M 042", "LDN 1455")
  if (TWO_TOKEN_PREFIXES.has(firstToken)) {
    const secondTokenMatch = rest.match(/^\s+(\S+)/);
    if (secondTokenMatch) {
      objectName = firstToken + ' ' + secondTokenMatch[1];
      rest = rest.slice(secondTokenMatch[0].length);
    }
  }

  // The data row wraps: the first physical line ends at the Type field,
  // and the continuation line has: Subtype, Score, Size, RA, DEC, Const, [Mag, Dist, Diam]
  // Join first physical line with the next non-blank line to get the full row
  let fullText = line;
  for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
    const nextLine = lines[j];
    if (nextLine.trim() === '') break;
    // Skip description/month marker lines (they don't have the Score+Size+RA pattern)
    fullText += ' ' + nextLine.trim();
    // Check if we now have the score pattern; if so, stop joining
    if (/\b[1-5]\b\s+\d+\.?\d*\s+\d{2}h/.test(fullText)) break;
  }

  // Extract the score: single digit 1–5 followed by size (decimal/integer) and RA (\d\dh)
  const scoreMatch = fullText.match(/\b([1-5])\b\s+\d+\.?\d*\s+\d{2}h/);
  if (!scoreMatch) {
    // No RA found on this row – skip
    skipped++;
    continue;
  }

  const score = parseInt(scoreMatch[1]);
  const normalizedId = normalizeName(objectName);

  if (normalizedId) {
    result[normalizedId] = score;
    parsed++;
  } else {
    skipped++;
  }
}

// Write output
fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));

const entries = Object.entries(result);
const byScore = [1, 2, 3, 4, 5].map((s) => [s, entries.filter(([, v]) => v === s).length]);
console.log(`Extracted ${parsed} entries, skipped ${skipped}`);
console.log('Score distribution:', Object.fromEntries(byScore));
console.log('Sample entries:', entries.slice(0, 10));
console.log(`Written to ${OUT_PATH}`);
