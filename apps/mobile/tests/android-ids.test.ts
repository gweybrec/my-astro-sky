/** The Android project's tests and sources use the app's own id, not the Capacitor template's. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = join(__dirname, '../android/app');
const gradle = readFileSync(join(app, 'build.gradle'), 'utf8');
const capacitor = readFileSync(join(__dirname, '../capacitor.config.ts'), 'utf8');
const APP_ID = gradle.match(/applicationId\s+"([^"]+)"/)?.[1];

function javaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? javaFiles(join(dir, e.name))
      : e.name.endsWith('.java')
        ? [join(dir, e.name)]
        : [],
  );
}
const src = join(app, 'src');
const sources = javaFiles(src);

describe('Android ids', () => {
  it('the Gradle namespace and Capacitor appId are the applicationId', () => {
    expect(APP_ID).toBe('com.gweybrec.myastrosky.app');
    expect(gradle).toContain(`namespace = "${APP_ID}"`);
    expect(capacitor).toContain(`appId: '${APP_ID}'`);
  });

  it('every package-name check in a test expects the applicationId', () => {
    const checks = sources.flatMap((f) =>
      [
        ...readFileSync(f, 'utf8').matchAll(
          /assertEquals\("([^"]+)",\s*\w+\.getPackageName\(\)\)/g,
        ),
      ].map((m) => m[1]),
    );
    expect(checks.length).toBeGreaterThan(0);
    for (const id of checks) expect(id).toBe(APP_ID);
  });

  it.each(sources.map((f) => relative(src, f)))(
    '%s is in the app package, in its folder',
    (file) => {
      const pkg = readFileSync(join(src, file), 'utf8').match(/^package\s+([\w.]+);/m)?.[1] ?? '';
      expect(pkg.startsWith(APP_ID!)).toBe(true);
      const dir = file.split(sep).slice(2, -1).join('.');
      expect(dir).toBe(pkg);
    },
  );
});
