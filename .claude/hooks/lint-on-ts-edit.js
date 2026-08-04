// PostToolUse hook: runs ESLint on a .ts/.vue file in src/, server/ or tests/ after
// it is edited, and reports **errors only**.
//
// Why errors only: the repo carries ~800 accepted warnings (see CLAUDE.md's warn-only
// convention), so surfacing warnings here would bury the signal. Errors are different —
// rules inherited from the `recommended` presets (e.g. @typescript-eslint/no-this-alias)
// are `error` severity and were never downgraded, so they DO fail the CI Lint step.
// One such error once reached CI because `npm run lint` was assumed to always exit 0.
//
// Invoked by the harness after Edit or Write tool calls. The harness sends the hook
// payload as JSON on stdin — { tool_name, tool_input: { file_path, ... }, tool_response }
// — not via an env var. `package.json` has "type": "module", so this file uses ESM.
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
  filePath &&
  /[/\\](src|server|tests)[/\\].+\.(ts|vue)$/.test(filePath) &&
  !filePath.endsWith('.d.ts');

if (!isTargetFile) process.exit(0);

// Run ESLint's JS entry point with the current node rather than shelling out to `npx`:
// no shell (so no arg-escaping deprecation), no npx.cmd/npx resolution difference between
// Windows and POSIX, and no dependency on PATH.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');

try {
  // --quiet reports errors and suppresses warnings; exit code is non-zero only when
  // errors remain. execFileSync (not execSync) so a path with spaces needs no quoting.
  execFileSync(process.execPath, [eslintBin, '--quiet', filePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  process.stderr.write(
    'ESLint errors (these fail the CI Lint step — warnings are not shown):\n' +
      out.split('\n').slice(-25).join('\n') +
      '\n',
  );
  process.exit(1);
}
