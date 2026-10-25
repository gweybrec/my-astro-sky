/** Capacitor's bridge logs every native call with its options; with CapacitorHttp that includes the astrometry key. */
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

describe('Capacitor config', () => {
  it('keeps the bridge logs out of release builds', () => {
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(true);
    // Unset means 'debug': logs in debug builds only.
    for (const behavior of [config.loggingBehavior, config.android?.loggingBehavior])
      expect(behavior ?? 'debug').toBe('debug');
  });
});
