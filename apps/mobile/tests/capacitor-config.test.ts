/** Capacitor's bridge logs every native call with its options; with CapacitorHttp that includes the astrometry key. */
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

describe('Capacitor config', () => {
  it('turns off the bridge logs, in debug builds too', () => {
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(true);
    expect(config.loggingBehavior).toBe('none');
    expect(config.android?.loggingBehavior).toBeUndefined();
  });
});
