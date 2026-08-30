// Stop hook: blocks the turn from ending when I edited the UI this turn but did
// not verify it. Two tiers:
//
//   * trivial  (a token/value swap, one class-string change, no new elements or
//              layout props) — I take a browser_take_screenshot of the changed
//              element and end the reply with the per-element checklist closed by
//              `<!-- ui-verified -->`.
//   * structural (new DOM / builder fn / .vue component, changed flex/grid/
//              position/size, layout CSS) — a cold-eyes `ui-verify-reviewer`
//              subagent that did NOT write the code signs it off. The turn must
//              contain an Agent/Task call with subagent_type "ui-verify-reviewer"
//              AND end with `<!-- ui-verified: reviewer=pass -->`.
//
// Either tier can be skipped when the user is verifying themselves, with a
// reasoned `<!-- ui-verified: <reason> -->`.
//
// The harness sends the Stop payload as JSON on stdin — { transcript_path,
// stop_hook_active, ... }. Blocking convention for a Stop hook: exit code 2 with
// the reason on stderr (the repo's PostToolUse hooks use exit-1+stderr for
// warnings; Stop uses exit-2 to block and feeds stderr back to me). `package.json`
// has "type": "module", so this file is ESM.
//
// FAIL-OPEN: any unexpected error → exit 0. A buggy guard must never wedge a session.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Signals that an edit touches the DOM / CSS (so it is a "UI" edit) — detected by
// content, not a filename list, so new/renamed DOM-builder files are covered
// automatically and pure-logic edits are ignored.
const DOM_SIGNAL =
  /createElement|className|classList|innerHTML|\.style\.|appendChild|insertBefore|removeChild|replaceChildren|setAttribute|:class=|class="/;

// Signals that a UI edit is *structural* (changes DOM shape or layout), not a
// cosmetic value tweak — routes it to the reviewer subagent.
const STRUCTURAL_SIGNAL =
  /createElement|appendChild|insertBefore|removeChild|replaceChildren|new [A-Za-z]*Element\b|<template|<div|<button|<section|display\s*:|(?<![-\w])flex(?![-\w])|(?<![-\w])grid(?![-\w])|position\s*:|width\s*:|height\s*:|gap\s*:|grid-template|flex-direction/;

const STRUCTURAL_NET_LINES = 12;

/** Every string an edit introduced or removed, concatenated. */
function editBlob(input) {
  if (!input) return '';
  let blob = `${input.old_string || ''}\n${input.new_string || ''}\n${input.content || ''}`;
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) blob += `\n${e.old_string || ''}\n${e.new_string || ''}`;
  }
  return blob;
}

/** Net added line count across an edit (new lines minus removed lines). */
function netAddedLines(input) {
  if (!input) return 0;
  const count = (s) => (s ? String(s).split('\n').length : 0);
  let added = count(input.content);
  added += count(input.new_string) - count(input.old_string);
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) added += count(e.new_string) - count(e.old_string);
  }
  return added;
}

/** A `.vue`/`.css`/`uno.config.ts` path, or (for other files) a DOM-signal edit —
 *  excluding pure i18n text files. */
function isUiEdit(name, input) {
  if (!input) return false;
  const f = String(input.file_path || '').replace(/\\/g, '/');
  if (!f) return false;
  if (/(^|\/)src\/i18n\//.test(f)) return false; // pure translation strings
  if (/(^|\/)src\/.*\.(vue|css)$/i.test(f)) return true;
  if (/(^|\/)src\/style\.css$/i.test(f)) return true;
  if (/(^|\/)uno\.config\.ts$/.test(f)) return true;
  // Content signal only for app source .ts/.tsx — so editing this guard, the
  // ui-verify skill, docs, or a test harness (all of which mention the signal
  // words literally) never trips it.
  if (!/(^|\/)src\/.*\.(ts|tsx)$/.test(f)) return false;
  return DOM_SIGNAL.test(editBlob(input));
}

/** 'none' | 'trivial' | 'structural' for the strongest UI edit in `entries`
 *  after `startIdx`. Pure — the test suite drives this directly. */
function classifyUiEdits(entries, startIdx) {
  let severity = 'none';
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || !e.message) continue;
    const content = e.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== 'tool_use') continue;
      if (!/^(Edit|Write|MultiEdit)$/.test(b.name)) continue;
      if (!isUiEdit(b.name, b.input)) continue;
      if (severity === 'none') severity = 'trivial';
      const f = String(b.input.file_path || '').replace(/\\/g, '/');
      const blob = editBlob(b.input);
      const structural =
        /\.vue$/i.test(f) ||
        STRUCTURAL_SIGNAL.test(blob) ||
        (/\.css$/i.test(f) && netAddedLines(b.input) > STRUCTURAL_NET_LINES);
      if (structural) return 'structural';
    }
  }
  return severity;
}

function contentHasText(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  return Array.isArray(content) && content.some((b) => b && b.type === 'text');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('\n');
}

/** Did the turn spawn the cold-eyes reviewer subagent? */
function calledReviewerSubagent(entries, startIdx) {
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || !e.message) continue;
    const content = e.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== 'tool_use') continue;
      if (!/^(Agent|Task)$/.test(b.name)) continue;
      if (b.input && b.input.subagent_type === 'ui-verify-reviewer') return true;
    }
  }
  return false;
}

function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const transcriptPath = payload.transcript_path;
  if (!transcriptPath) process.exit(0);

  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }

  // Boundary of the current turn = after the last genuine user message (a real
  // prompt, not a tool_result). Scoping to this turn means a dirty tree from an
  // earlier (already-verified) turn doesn't nag.
  let startIdx = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.type === 'user' && contentHasText(e.message && e.message.content)) {
      startIdx = i + 1;
      break;
    }
  }

  let screenshotTaken = false;
  let lastAssistantText = '';
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || !e.message) continue;
    const content = e.message.content;
    if (!Array.isArray(content)) continue;
    let hasText = false;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use') {
        if (b.name === 'mcp__playwright__browser_take_screenshot') screenshotTaken = true;
      } else if (b.type === 'text') {
        hasText = true;
      }
    }
    if (hasText) lastAssistantText = textOf(content); // keep the latest assistant text
  }

  const severity = classifyUiEdits(entries, startIdx);
  if (severity === 'none') process.exit(0);

  // A reasoned skip (`<!-- ui-verified: <reason> -->`, reason not "reviewer=fail")
  // means the user is verifying — honoured for both tiers.
  const reasonedSkip = /<!--\s*ui-verified\s*:\s*(?!reviewer=)\S[^>]*-->/.test(lastAssistantText);
  if (reasonedSkip) process.exit(0);

  if (severity === 'structural') {
    const reviewerPass = /<!--\s*ui-verified\s*:\s*reviewer=pass\s*-->/.test(lastAssistantText);
    if (calledReviewerSubagent(entries, startIdx) && reviewerPass) process.exit(0);
    process.stderr.write(
      'UI-VERIFY GUARD: you made a STRUCTURAL UI change this turn (new DOM / builder fn /\n' +
        '.vue component, or changed layout CSS) and did not get it signed off.\n' +
        'Before presenting: use the `ui-verify` skill’s structural path — spawn the\n' +
        '`ui-verify-reviewer` subagent (Agent tool, run_in_background:false), hand it the\n' +
        'verbatim request + git diff + dev-server URL + target selector, then paste its\n' +
        'per-element table and VERDICT line into your reply, closed by\n' +
        '`<!-- ui-verified: reviewer=pass -->`. If it returns FAIL, fix and re-run it.\n' +
        'If the user is verifying instead, close with `<!-- ui-verified: <reason> -->`.\n',
    );
    process.exit(2);
  }

  // trivial
  if (screenshotTaken && /<!--\s*ui-verified\s*-->/.test(lastAssistantText)) process.exit(0);
  process.stderr.write(
    'UI-VERIFY GUARD: you edited the UI this turn but did not verify it.\n' +
      'Before presenting: use the `ui-verify` skill — take a browser_take_screenshot of the\n' +
      'CHANGED component, measure it with browser_evaluate (getBoundingClientRect /\n' +
      'getComputedStyle), and end your reply with the per-element checklist (colour, size,\n' +
      'alignment, overflow-on-rename, justify any fixed size) closed by `<!-- ui-verified -->`.\n' +
      'If the user is verifying instead, close with `<!-- ui-verified: <reason> -->` to skip.\n',
  );
  process.exit(2);
}

// Only run when invoked directly (stdin is the Stop payload); stay silent on import
// so the test suite can exercise the pure classifiers.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch {
    process.exit(0); // fail-open: never wedge the session on a guard bug
  }
}

export { isUiEdit, classifyUiEdits, calledReviewerSubagent, netAddedLines, editBlob };
