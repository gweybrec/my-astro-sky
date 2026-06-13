import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecFileAsync,
  mockFspMkdtemp,
  mockFspWriteFile,
  mockFspReadFile,
  mockFspRm,
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
  },
  existsSync: mockExistsSync,
  default: {
    promises: {
      mkdtemp: mockFspMkdtemp,
      writeFile: mockFspWriteFile,
      readFile: mockFspReadFile,
      rm: mockFspRm,
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

vi.mock('../../server/db', () => ({
  getSetting: mockGetSetting,
}));

vi.mock('../../server/wsl-utils', () => ({
  shouldUseWSL: mockShouldUseWSL,
  wrapExecForWSL: mockWrapExecForWSL,
  wslPath: mockWslPath,
}));

import { solveWithSolveField } from '../../server/solve-field';

describe('solveWithSolveField()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSetting.mockImplementation((key: string) => {
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
    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(true);
    expect(result.correspondences).toHaveLength(3);
    expect(result.dsoIds).toEqual(['M42']);
  });

  it('builds scale and position arguments from hints and adds downsample for large images', async () => {
    await solveWithSolveField(
      Buffer.from('img'),
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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');
    expect(result.success).toBe(false);
    expect(result.error).toContain('solve-field failed');
    expect(result.error).toContain('5');
  });

  it('adds --config argument when ASTROMETRY_DATA_DIR is configured', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'SOLVE_FIELD_PATH') return null;
      if (key === 'ASTROMETRY_DATA_DIR') return '/usr/share/astrometry';
      if (key === 'USE_WSL_FOR_SOLVE_FIELD') return null;
      return null;
    });

    await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');
    const args = mockWrapExecForWSL.mock.calls[0][1] as string[];
    expect(args).toContain('--config');
    expect(args).toContain('/etc/astrometry.cfg');
  });

  it('returns error when WCS file is not produced even on successful command exit', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not produce a WCS file');
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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing WCS key: CD2_2');
  });

  it('always passes --uniformize 0 to skip the pyfits/astropy dependency', async () => {
    await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');
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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

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

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/index|install-solve-field/i);
  });

  it('returns noPyfits error when uniformize Python dependency is missing', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockRejectedValue({
      stdout: "AttributeError: 'NoPyfits' object has no attribute 'open'\naugment-xylist.c: Failed to run command: python3 -m astrometry.util.uniformize\n",
      stderr: '',
      message: 'exit 1',
    });

    const result = await solveWithSolveField(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pyfits|astropy/i);
  });
});
