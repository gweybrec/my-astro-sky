/**
 * Tests for electron/external-links.ts: which new-window links (target="_blank",
 * e.g. "Voir sur TNS") the desktop app hands to the OS default browser instead of
 * opening an in-app window.
 */
import { describe, it, expect } from 'vitest';
import { shouldOpenExternally } from '../../electron/external-links';

const APP = 'http://localhost:3001';

describe('shouldOpenExternally()', () => {
  it('sends web pages to the default browser', () => {
    expect(shouldOpenExternally('https://www.wis-tns.org/object/2026aaiv', APP)).toBe(true);
    expect(shouldOpenExternally('http://example.org/page', APP)).toBe(true);
  });

  it('never externalises the app itself', () => {
    expect(shouldOpenExternally('http://localhost:3001/uploads/a.jpg', APP)).toBe(false);
  });

  it('refuses non-web and malformed URLs', () => {
    expect(shouldOpenExternally('file:///C:/Windows/system32/calc.exe', APP)).toBe(false);
    expect(shouldOpenExternally('javascript:alert(1)', APP)).toBe(false);
    expect(shouldOpenExternally('not a url', APP)).toBe(false);
  });
});
