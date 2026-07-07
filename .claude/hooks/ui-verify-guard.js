// Stop hook: blocks the turn from ending when I edited the UI this turn but did
// not verify it (screenshot the changed component + emit the verification
// checklist). Forces me to actually look at my UI work before presenting it,
// instead of reporting from a full-page glance or from memory.
//
// The harness sends the Stop payload as JSON on stdin — { transcript_path,
// stop_hook_active, ... }. Blocking convention for a Stop hook: exit code 2 with
// the reason on stderr (the repo's PostToolUse hooks use exit-1+stderr for
// warnings; Stop uses exit-2 to block and feeds stderr back to me). `package.json`
// has "type": "module", so this file is ESM.
//
// FAIL-OPEN: any unexpected error → exit 0. A buggy guard must never wedge a session.
import { readFileSync } from 'node:fs';

// Signals that an edit touches the DOM / CSS (so it is a "UI" edit) — detected by
// content, not a filename list, so new/renamed DOM-builder files are covered
// automatically and pure-logic edits are ignored.
const DOM_SIGNAL =
  /createElement|className|classList|innerHTML|\.style\.|appendChild|setAttribute|:class=|class="/;

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
  // Gather every string the edit introduced/removed and test for DOM signals.
  let blob = `${input.old_string || ''}\n${input.new_string || ''}\n${input.content || ''}`;
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) blob += `\n${e.old_string || ''}\n${e.new_string || ''}`;
  }
  return DOM_SIGNAL.test(blob);
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

try {
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

  let uiEdited = false;
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
        if (/^(Edit|Write|MultiEdit)$/.test(b.name) && isUiEdit(b.name, b.input)) uiEdited = true;
      } else if (b.type === 'text') {
        hasText = true;
      }
    }
    if (hasText) lastAssistantText = textOf(content); // keep the latest assistant text
  }

  if (!uiEdited) process.exit(0);

  const hasReasoned = /<!--\s*ui-verified\s*:\s*\S[^>]*-->/.test(lastAssistantText);
  const hasPlain = /<!--\s*ui-verified\s*-->/.test(lastAssistantText);
  const passes = hasReasoned || (hasPlain && screenshotTaken);
  if (passes) process.exit(0);

  process.stderr.write(
    'UI-VERIFY GUARD: you edited the UI this turn but did not verify it.\n' +
      'Before presenting: use the `ui-verify` skill — take a browser_take_screenshot of the\n' +
      'CHANGED component, measure it with browser_evaluate (getBoundingClientRect /\n' +
      'getComputedStyle), and end your reply with the per-element checklist (colour, size,\n' +
      'alignment, overflow-on-rename, justify any fixed size) closed by `<!-- ui-verified -->`.\n' +
      'If the user is verifying instead, close with `<!-- ui-verified: <reason> -->` to skip.\n',
  );
  process.exit(2);
} catch {
  process.exit(0); // fail-open: never wedge the session on a guard bug
}
