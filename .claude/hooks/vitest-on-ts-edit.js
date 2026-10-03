// PostToolUse hook: runs only the Vitest tests related to a .ts file edited under
// a src/ or server/ path segment (`vitest related`, not the full suite).
// Invoked by the harness after Edit or Write tool calls. The harness sends the
// hook payload as JSON on stdin — { tool_name, tool_input: { file_path, ... },
// tool_response } — not via an env var. `package.json` has "type": "module", so
// this file uses ESM import/export rather than require().
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let filePath = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  filePath = input.tool_input?.file_path || '';
} catch (_) {}

const isTargetFile =
  filePath && /[/\\](src|server)[/\\].+\.ts$/.test(filePath) && !filePath.endsWith('.d.ts');

if (!isTargetFile) process.exit(0);

// Run Vitest's JS entry point with the current node rather than through `npx`/`npx.cmd`:
// no shell, so file_path stays a plain argv entry (a path with spaces or shell metacharacters
// is never re-parsed), and no npx resolution difference between Windows and POSIX.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vitestBin = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

try {
  const output = execFileSync(
    process.execPath,
    [vitestBin, 'related', filePath, '--run', '--reporter=dot', '--passWithNoTests'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const lines = output.trim().split('\n');
  process.stdout.write(lines.slice(-25).join('\n') + '\n');
} catch (err) {
  const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  process.stderr.write(out.split('\n').slice(-25).join('\n') + '\n');
  process.exit(1);
}
