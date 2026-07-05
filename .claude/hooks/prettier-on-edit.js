// PostToolUse hook: runs Prettier --write on a file after Edit or Write, for any
// extension Prettier formats (matches .prettierrc.json's scope, minus .prettierignore
// exclusions which prettier itself respects). The harness sends the hook payload as
// JSON on stdin — { tool_name, tool_input: { file_path, ... }, tool_response } — not
// via an env var. `package.json` has "type": "module", so this uses ESM import/export.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let filePath = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  filePath = input.tool_input?.file_path || '';
} catch (_) {}

const isFormattable =
  filePath && /\.(ts|tsx|vue|js|mjs|cjs|jsx|json|css|scss|html|md|yml|yaml)$/.test(filePath);

if (!isFormattable) process.exit(0);

// Invoke Prettier's CLI entry point directly via `node` rather than through the
// npx/npx.cmd shim, so file_path stays a plain argv entry with no shell involved
// (avoids the Windows npx-shim resolution issue without needing shell:true).
const prettierBin = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');

try {
  execFileSync(process.execPath, [prettierBin, '--write', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  process.stderr.write(out.split('\n').slice(-25).join('\n') + '\n');
  process.exit(1);
}
