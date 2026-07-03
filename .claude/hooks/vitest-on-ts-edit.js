// PostToolUse hook: runs Vitest when a .ts file in src/ or server/ is edited.
// Invoked by the harness after Edit or Write tool calls.
const { execSync } = require('child_process');

let filePath = '';
try {
  const input = JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}');
  filePath = input.file_path || '';
} catch (_) {}

const isTargetFile =
  filePath && /[/\\](src|server)[/\\].+\.ts$/.test(filePath) && !filePath.endsWith('.d.ts');

if (!isTargetFile) process.exit(0);

try {
  const output = execSync('npx vitest run --reporter=dot', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = output.trim().split('\n');
  process.stdout.write(lines.slice(-25).join('\n') + '\n');
} catch (err) {
  const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  process.stderr.write(out.split('\n').slice(-25).join('\n') + '\n');
  process.exit(1);
}
