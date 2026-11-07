import { describe, it, expect } from 'vitest';
import { dsoQueryVariants } from '@myastrosky/core/dso-query';

describe('dsoQueryVariants', () => {
  it('adds the NGC reading of a text typed with "ngv" or "nhc", in any case', () => {
    expect(dsoQueryVariants('ngv7000')).toEqual(['ngv7000', 'ngc7000']);
    expect(dsoQueryVariants('NHC 7000')).toEqual(['NHC 7000', 'ngc 7000']);
    expect(dsoQueryVariants('  Ngv')).toEqual(['  Ngv', 'ngc']);
  });

  it('leaves any other text alone, the prefixes inside a word included', () => {
    expect(dsoQueryVariants('ngc7000')).toEqual(['ngc7000']);
    expect(dsoQueryVariants('ng')).toEqual(['ng']);
    expect(dsoQueryVariants('m31 ngv')).toEqual(['m31 ngv']);
    expect(dsoQueryVariants('')).toEqual(['']);
  });
});
