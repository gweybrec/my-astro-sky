/** The FileProvider that the share sheet goes through can hand out the cache's `exports/` folder and nothing else. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = join(__dirname, '../android/app/src/main');
const manifest = readFileSync(join(main, 'AndroidManifest.xml'), 'utf8');
const paths = readFileSync(join(main, 'res/xml/file_paths.xml'), 'utf8');

describe('Android FileProvider', () => {
  it('is not exported and reads its paths from file_paths.xml', () => {
    const provider = manifest.split('<provider')[1]?.split('</provider>')[0] ?? '';
    expect(provider).toContain('android:exported="false"');
    expect(provider).toContain('android:resource="@xml/file_paths"');
  });

  it('shares only the exports folder of the cache, where shareFile writes', () => {
    const entries = paths.match(/<[a-z-]+-path\b[^>]*\/>/g) ?? [];
    expect(entries).toEqual(['<cache-path name="exports" path="exports/" />']);
  });
});
