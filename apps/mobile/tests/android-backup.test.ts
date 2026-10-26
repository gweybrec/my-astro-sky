/** Android's own backup and phone-to-phone transfer copy none of the app's data (the WebView keeps the key that decrypts the astrometry key). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = join(__dirname, '../android/app/src/main');
const manifest = readFileSync(join(main, 'AndroidManifest.xml'), 'utf8');
const rules = readFileSync(join(main, 'res/xml/data_extraction_rules.xml'), 'utf8');
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

describe('Android backup', () => {
  it('is turned off and points at the extraction rules', () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it.each(['cloud-backup', 'device-transfer'])(
    '%s excludes every domain and includes nothing',
    (section) => {
      const body = rules.split(`<${section}>`)[1]?.split(`</${section}>`)[0] ?? '';
      for (const domain of DOMAINS)
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      expect(body).not.toContain('<include');
    },
  );
});
