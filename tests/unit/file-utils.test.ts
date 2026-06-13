import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripExtension, getFileDimensions } from '../../src/file-utils';

describe('stripExtension', () => {
  it('removes a simple extension', () => {
    expect(stripExtension('M1_CCD_siril.fit')).toBe('M1_CCD_siril');
  });

  it('removes .jpg extension', () => {
    expect(stripExtension('M31_andromeda.jpg')).toBe('M31_andromeda');
  });

  it('removes .fits extension', () => {
    expect(stripExtension('LDN1235.fits')).toBe('LDN1235');
  });

  it('removes .jpeg extension', () => {
    expect(stripExtension('photo.jpeg')).toBe('photo');
  });

  it('removes .png extension', () => {
    expect(stripExtension('nebula.png')).toBe('nebula');
  });

  it('removes only the last extension when multiple dots are present', () => {
    expect(stripExtension('M1.CCD.siril.fit')).toBe('M1.CCD.siril');
  });

  it('returns the string unchanged when there is no extension', () => {
    expect(stripExtension('myfile')).toBe('myfile');
  });

  it('strips everything when the only dot is the leading one (dotfile)', () => {
    // The regex matches the leading dot as an extension separator, leaving ''
    expect(stripExtension('.hidden')).toBe('');
  });

  it('handles an empty string', () => {
    expect(stripExtension('')).toBe('');
  });
});

describe('getFileDimensions', () => {
  const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  const mockRevokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mockCreateObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mockRevokeObjectURL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves with naturalWidth and naturalHeight on successful load', async () => {
    class MockImage {
      naturalWidth = 1920;
      naturalHeight = 1080;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { Promise.resolve().then(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);

    const file = new File([''], 'photo.jpg', { type: 'image/jpeg' });
    const result = await getFileDimensions(file);
    expect(result).toEqual({ width: 1920, height: 1080 });
    expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('resolves with {width:0, height:0} on load error', async () => {
    class MockImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { Promise.resolve().then(() => this.onerror?.()); }
    }
    vi.stubGlobal('Image', MockImage);

    const file = new File([''], 'broken.jpg', { type: 'image/jpeg' });
    const result = await getFileDimensions(file);
    expect(result).toEqual({ width: 0, height: 0 });
    expect(mockRevokeObjectURL).toHaveBeenCalled();
  });
});
