import { describe, it, expect } from 'vitest';
import { shouldExitOnBack } from '../src/platform-init';

describe('the hardware back button', () => {
  it.each(['/tabs/sky', '/tabs/gallery', '/tabs/targets', '/tabs/settings', '/tabs/plans/'])(
    'leaves the app from the top-level tab %s',
    (path) => {
      expect(shouldExitOnBack(path)).toBe(true);
    },
  );

  it.each(['/tabs/plans/42', '/tabs/settings/setups', '/other'])(
    'leaves a pushed page %s to the router',
    (path) => {
      expect(shouldExitOnBack(path)).toBe(false);
    },
  );
});
