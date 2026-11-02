/** Capacitor's bridge logs every native call with its options; with CapacitorHttp that includes the astrometry key. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@myastrosky/core/theme';
import config from '../capacitor.config';

const mobile = join(__dirname, '..');
const read = (path: string) => readFileSync(join(mobile, path), 'utf8');

describe('Capacitor config', () => {
  it('keeps the bridge logs out of release builds', () => {
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(true);
    // Unset means 'debug': logs in debug builds only.
    for (const behavior of [config.loggingBehavior, config.android?.loggingBehavior])
      expect(behavior ?? 'debug').toBe('debug');
  });

  it('starts on the default theme background, from the launch screen to the first paint', () => {
    const tokens = read('src/theme/design-system/tokens.css');
    const block = tokens.slice(tokens.indexOf(`[data-theme='${DEFAULT_THEME}']`));
    const background = /--bg-app:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
    expect(background).toBeDefined();

    expect(config.backgroundColor).toBe(background);
    const res = 'android/app/src/main/res';
    expect(read(`${res}/values/ic_launcher_background.xml`)).toContain(`>${background}<`);
    const styles = read(`${res}/values/styles.xml`);
    expect(styles).toContain(
      '<item name="windowSplashScreenBackground">@color/ic_launcher_background</item>',
    );
    expect(styles).toContain(
      '<item name="android:windowBackground">@color/ic_launcher_background</item>',
    );
  });
});
