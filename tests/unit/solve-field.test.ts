import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecFileAsync,
  mockFspMkdtemp,
  mockFspWriteFile,
  mockFspReadFile,
  mockFspRm,
  mockFspRename,
  mockExistsSync,
  mockParseFITSHeader,
  mockWcsToCorrespondences,
  mockNormalizeDSOAliases,
  mockGetSetting,
  mockShouldUseWSL,
  mockWrapExecForWSL,
  mockWslPath,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFspMkdtemp: vi.fn(),
  mockFspWriteFile: vi.fn(),
  mockFspReadFile: vi.fn(),
  mockFspRm: vi.fn(),
  mockFspRename: vi.fn(),
  mockExistsSync: vi.fn(),
  mockParseFITSHeader: vi.fn(),
  mockWcsToCorrespondences: vi.fn(),
  mockNormalizeDSOAliases: vi.fn((entries: string[]) => entries.map((s) => s.replace(/\s+/g, ''))),
  mockGetSetting: vi.fn(),
  mockShouldUseWSL: vi.fn(),
  mockWrapExecForWSL: vi.fn(),
  mockWslPath: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
  default: {
    promisify: vi.fn(() => mockExecFileAsync),
  },
}));

vi.mock('fs', () => ({
  promises: {
    mkdtemp: mockFspMkdtemp,
    writeFile: mockFspWriteFile,
    readFile: mockFspReadFile,
    rm: mockFspRm,
    rename: mockFspRename,
  },
  existsSync: mockExistsSync,
  default: {
    promises: {
      mkdtemp: mockFspMkdtemp,
      writeFile: mockFspWriteFile,
      readFile: mockFspReadFile,
      rm: mockFspRm,
      rename: mockFspRename,
    },
    existsSync: mockExistsSync,
  },
}));

vi.mock('../../server/wcs-reader', () => ({
  parseFITSHeader: mockParseFITSHeader,
  wcsToCorrespondences: mockWcsToCorrespondences,
}));

vi.mock('../../server/dso-utils', () => ({
  normalizeDSOAliases: mockNormalizeDSOAliases,
}));

vi.mock('../../server/services', () => ({
  settings: { get: mockGetSetting },
}));

vi.mock('../../server/wsl-utils', () => ({
  shouldUseWSL: mockShouldUseWSL,
  wrapExecForWSL: mockWrapExecForWSL,
  wslPath: mockWslPath,
}));

import { solveWithSolveField, tiffToSolveFieldFits } from '../../server/solve-field';
import { buildTiff } from '../fixtures/tiff-builders';

/** A 2×2 RGB TIFF whose pixel (x, y) has red = green = blue = `values[y * 2 + x]` in the given format. */
function rgbTiff(bitsPerSample: 8 | 16 | 32, values: number[]): Buffer {
  return buildTiff({
    width: 2,
    height: 2,
    bitsPerSample,
    sampleFormat: bitsPerSample === 32 ? 3 : 1,
    samplesPerPixel: 3,
    photometric: 2,
    pixels: values.flatMap((v) => [v, v, v]),
  });
}

/** The FITS file the pieces make, or null. */
function fitsOf(pieces: Iterable<Buffer> | null): Buffer | null {
  return pieces && Buffer.concat([...pieces]);
}

describe('tiffToSolveFieldFits()', () => {
  it('turns a 32-bit float TIFF into a float FITS, grey, top row first', () => {
    const fits = fitsOf(tiffToSolveFieldFits(rgbTiff(32, [0.1, 0.2, 0.3, 0.4])));
    expect(fits).not.toBeNull();
    const header = fits!.subarray(0, 2880).toString('ascii');
    expect(header).toMatch(/^SIMPLE {2}= +T/);
    expect(header).toMatch(/BITPIX {2}= +-32/);
    expect(header).toMatch(/NAXIS1 {2}= +2 /);
    expect(header).toMatch(/NAXIS2 {2}= +2 /);
    expect(fits!.length).toBe(2 * 2880);
    const pixels = [0, 1, 2, 3].map((i) => fits!.readFloatBE(2880 + i * 4));
    pixels.forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.2, 0.3, 0.4][i], 5));
  });

  it('leaves 8- and 16-bit TIFFs as they are (solve-field reads them)', () => {
    expect(tiffToSolveFieldFits(rgbTiff(8, [0, 50, 100, 255]))).toBeNull();
    expect(tiffToSolveFieldFits(rgbTiff(16, [0, 1000, 30000, 65535]))).toBeNull();
  });

  it('writes the body in strips of rows, the last one padded to a whole block', () => {
    // 3 × 300 mono: a strip of 256 rows, then one of 44; 3600 bytes of samples padded to 5760.
    const width = 3;
    const height = 300;
    const tiff = buildTiff({
      width,
      height,
      bitsPerSample: 32,
      sampleFormat: 3,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Array.from({ length: width * height }, (_, i) => i),
    });
    const pieces = [...tiffToSolveFieldFits(tiff)!];
    expect(pieces.map((p) => p.length)).toEqual([2880, 256 * width * 4, 44 * width * 4 + 2160]);
    const fits = Buffer.concat(pieces);
    expect(fits.length).toBe(2880 + 5760);
    for (const i of [0, 767, 768, 899]) expect(fits.readFloatBE(2880 + i * 4)).toBe(i);
    expect(fits.subarray(2880 + 3600).every((b) => b === 0)).toBe(true);
  });
});

describe('solveWithSolveField()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'SOLVE_FIELD_PATH') return null;
      if (key === 'ASTROMETRY_DATA_DIR') return null;
      if (key === 'USE_WSL_FOR_SOLVE_FIELD') return null;
      return null;
    });

    mockShouldUseWSL.mockReturnValue(false);
    mockWslPath.mockImplementation((p: string) => p);
    mockWrapExecForWSL.mockImplementation((cmd: string, args: string[]) => ({ cmd, args }));

    mockFspMkdtemp.mockResolvedValue('/tmp/solve-field-test');
    mockFspWriteFile.mockResolvedValue(undefined);
    mockFspRename.mockResolvedValue(undefined);
    mockFspReadFile.mockResolvedValue(
      [
        'CRPIX1  =                 960.0',
        'CRPIX2  =                 540.0',
        'CRVAL1  =                 84.05',
        'CRVAL2  =                 -1.20',
        'CD1_1   =             -0.000417',
        'CD1_2   =                  0.0',
        'CD2_1   =                  0.0',
        'CD2_2   =              0.000417',
      ].join('\n'),
    );
    mockFspRm.mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);

    mockExecFileAsync.mockResolvedValue({ stdout: 'Your field contains:\nM 42\n\n', stderr: '' });

    mockParseFITSHeader.mockReturnValue({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      CD1_1: -0.000417,
      CD1_2: 0,
      CD2_1: 0,
      CD2_2: 0.000417,
    });

    mockWcsToCorrespondences.mockReturnValue([
      { pointIndex: 0, photoX: 10, photoY: 10, starHip: 1, starName: 'A' },
      { pointIndex: 1, photoX: 20, photoY: 20, starHip: 2, starName: 'B' },
      { pointIndex: 2, photoX: 30, photoY: 30, starHip: 3, starName: 'C' },
    ]);
  });

  it('returns success with correspondences and parsed DSO IDs', async () => {
    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(true);
    expect(result.correspondences).toHaveLength(3);
    expect(result.dsoIds).toEqual(['M42']);
  });

  it('builds scale and position arguments from hints and adds downsample for large images', async () => {
    await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      4096,
      3000,
      { ra: 84.05, dec: -1.2, fov: 2, radius: 1.5 },
      'en',
    );

    expect(mockWrapExecForWSL).toHaveBeenCalledOnce();
    const args = mockWrapExecForWSL.mock.calls[0][1] as string[];

    expect(args).toContain('--scale-low');
    expect(args).toContain('--scale-high');
    expect(args).toContain('--scale-units');
    expect(args).toContain('arcsecperpix');
    expect(args).toContain('--ra');
    expect(args).toContain('84.05');
    expect(args).toContain('--dec');
    expect(args).toContain('-1.2');
    expect(args).toContain('--radius');
    expect(args).toContain('1.5');
    expect(args).toContain('--downsample');
    expect(args).toContain('2');
  });

  it('returns localized index-missing error when solve-field output reports missing index files', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: '',
      stderr: 'Could not find index / no index files',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/index|install-solve-field/i);
  });

  it('returns informative no-solution error and includes hint guidance when no hints are provided', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: 'Field: examined 42\n0 matches\nFailed to solve\n',
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No solution found');
    expect(result.error).toContain('42');
  });

  it('returns generic failure message when solve output does not match no-solution patterns', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: 'Field: examined 5\nunexpected fatal parser issue\n',
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('solve-field failed');
    expect(result.error).toContain('5');
  });

  it('adds --config argument when ASTROMETRY_DATA_DIR is configured', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'SOLVE_FIELD_PATH') return null;
      if (key === 'ASTROMETRY_DATA_DIR') return '/usr/share/astrometry';
      if (key === 'USE_WSL_FOR_SOLVE_FIELD') return null;
      return null;
    });

    await solveWithSolveField('/incoming/upload.part', '.jpg', 1920, 1080, undefined, 'en');
    const args = mockWrapExecForWSL.mock.calls[0][1] as string[];
    expect(args).toContain('--config');
    expect(args).toContain('/etc/astrometry.cfg');
  });

  it('returns error when WCS file is not produced even on successful command exit', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not produce a WCS file');
  });

  it('includes diagnostics with the command (using the user filename) on the WCS-missing success-exit path', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockResolvedValue({
      stdout: 'Reading input file...\nSolving...\nno match found within the search radius\n',
      stderr: 'warning: low contrast image\n',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
      undefined,
      'Andromeda.jpg',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not produce a WCS file');
    // The raw solver output (stdout + stderr) must reach the error-details collapsible.
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics).toContain('no match found within the search radius');
    expect(result.diagnostics).toContain('low contrast image');
    // The command line uses the user's filename, not the backend temp path.
    expect(result.diagnostics).toContain('$ solve-field Andromeda.jpg');
    expect(result.diagnostics).not.toContain('input.jpg');
  });

  it('returns error when parsed WCS misses a required key', async () => {
    mockParseFITSHeader.mockReturnValue({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      CD1_1: -0.000417,
      CD1_2: 0,
      CD2_1: 0,
      // CD2_2 missing
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing WCS key: CD2_2');
    expect(result.diagnostics).toContain('Your field contains');
  });

  it('always passes --uniformize 0 to skip the pyfits/astropy dependency', async () => {
    await solveWithSolveField('/incoming/upload.part', '.jpg', 1920, 1080, undefined, 'en');
    const args = mockWrapExecForWSL.mock.calls[0][1] as string[];
    const idx = args.indexOf('--uniformize');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('0');
  });

  it('populates diagnostics with last lines of output on generic failure', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n',
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toBeDefined();
    // Last 6 non-empty lines — line7 is last so must be present
    expect(result.diagnostics).toContain('line7');
    // line1 is beyond the last-6 window and must NOT appear
    expect(result.diagnostics).not.toContain('line1');
  });

  it('populates diagnostics on no-solution failure', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: 'Field: examined 10\n0 matches\nFailed to solve\ndetail line A\n',
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toContain('detail line A');
  });

  it('merges stderr and stdout when searching for diagnostic patterns', async () => {
    // Index-missing message is in stdout; stderr has an unrelated warning.
    // With the old `stderr || stdout` logic this would fail (stderr wins, stdout lost).
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stderr: 'WARNING: some unrelated stderr line\n',
      stdout: 'no index files in /usr/share/astrometry\n',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/index|install-solve-field/i);
  });

  it('returns noPyfits error when uniformize Python dependency is missing', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout:
        "AttributeError: 'NoPyfits' object has no attribute 'open'\naugment-xylist.c: Failed to run command: python3 -m astrometry.util.uniformize\n",
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(
      '/incoming/upload.part',
      '.jpg',
      1920,
      1080,
      undefined,
      'en',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pyfits|astropy/i);
  });

  it('hands a 32-bit TIFF to solve-field as input.fits, keeping the picture Y convention', async () => {
    mockFspReadFile.mockResolvedValueOnce(rgbTiff(32, [0.1, 0.2, 0.3, 0.4]));
    await solveWithSolveField('/incoming/upload.part', '.tiff', 2, 2, undefined, 'en');
    expect(mockFspReadFile).toHaveBeenNthCalledWith(1, '/incoming/upload.part');
    const [writtenPath, written] = mockFspWriteFile.mock.calls[0] as [string, Iterable<Buffer>];
    expect(writtenPath).toMatch(/input\.fits$/);
    expect(fitsOf(written)!.subarray(0, 6).toString('ascii')).toBe('SIMPLE');
    expect(mockFspRename).not.toHaveBeenCalled();
    expect((mockWrapExecForWSL.mock.calls[0][1] as string[])[0]).toMatch(/input\.fits$/);
    expect(mockWcsToCorrespondences).toHaveBeenCalledWith(expect.anything(), 2, 2, false);
  });

  it('hands an 8-bit TIFF to solve-field unchanged, moving the upload into place', async () => {
    mockFspReadFile.mockResolvedValueOnce(rgbTiff(8, [0, 50, 100, 255]));
    await solveWithSolveField('/incoming/upload.part', '.tif', 2, 2, undefined, 'en');
    expect(mockFspRename).toHaveBeenCalledWith(
      '/incoming/upload.part',
      expect.stringMatching(/input\.tif$/),
    );
    expect(mockFspWriteFile).not.toHaveBeenCalled();
  });

  it('moves any other upload into place without reading it', async () => {
    await solveWithSolveField('/incoming/upload.part', '.fits', 1920, 1080, undefined, 'en');
    expect(mockFspRename).toHaveBeenCalledWith(
      '/incoming/upload.part',
      expect.stringMatching(/input\.fits$/),
    );
    expect(mockFspReadFile).not.toHaveBeenCalledWith('/incoming/upload.part');
    expect(mockFspWriteFile).not.toHaveBeenCalled();
  });
});
