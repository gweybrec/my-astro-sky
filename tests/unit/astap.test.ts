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

vi.mock('../../server/db', () => ({
  getSetting: mockGetSetting,
}));

vi.mock('../../server/wsl-utils', () => ({
  shouldUseWSL: mockShouldUseWSL,
  wrapExecForWSL: mockWrapExecForWSL,
  wslPath: mockWslPath,
}));

import { solveWithASTAP, cdMatrixSkewDeg, MAX_CD_SKEW_DEG } from '../../server/astap';

// Real CD matrices captured from running ASTAP on test-photos/M97+M108.jpg.
// Conformal = a correct solve; sheared = ASTAP's wrong-scale false match.
const CONFORMAL_CD = { CD1_1: -5.777e-4, CD1_2: 3.259e-4, CD2_1: 3.261e-4, CD2_2: 5.58e-4 };
const SHEARED_CD = { CD1_1: -7.054e-4, CD1_2: 7.831e-5, CD2_1: -5.001e-4, CD2_2: 5.305e-4 };

describe('cdMatrixSkewDeg()', () => {
  it('is ~0 for a conformal (perpendicular, equal-length) CD matrix', () => {
    expect(cdMatrixSkewDeg({ CD1_1: -4.17e-4, CD1_2: 0, CD2_1: 0, CD2_2: 4.17e-4 })).toBeCloseTo(
      0,
      5,
    );
    expect(cdMatrixSkewDeg(CONFORMAL_CD)).toBeLessThan(MAX_CD_SKEW_DEG);
  });

  it("is large for ASTAP's sheared false-match CD matrix", () => {
    const skew = cdMatrixSkewDeg(SHEARED_CD);
    expect(skew).toBeGreaterThan(40);
    expect(skew).toBeGreaterThan(MAX_CD_SKEW_DEG);
  });
});

describe('solveWithASTAP()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'ASTAP_PATH') return null;
      if (key === 'USE_WSL_FOR_ASTAP') return null;
      return null;
    });

    mockShouldUseWSL.mockReturnValue(false);
    mockWslPath.mockImplementation((p: string) => p);
    mockWrapExecForWSL.mockImplementation((cmd: string, args: string[]) => ({ cmd, args }));

    mockFspMkdtemp.mockResolvedValue('/tmp/astap-test');
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

    mockExecFileAsync.mockResolvedValue({ stdout: 'Solution found.\n', stderr: '' });

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

  it('returns success with correspondences from the ASTAP WCS', async () => {
    const result = await solveWithASTAP(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(true);
    expect(result.correspondences).toHaveLength(3);
  });

  // Regression guard for the FITS Y-axis convention bug: ASTAP emits FITS-convention
  // WCS (origin bottom-left, Y up), so correspondences MUST be generated with
  // fitsYConvention=true — otherwise placements come out vertically flipped/skewed.
  // solve-field and astrometry.net stay false (display convention) and are untouched.
  it('generates correspondences with fitsYConvention=true (FITS bottom-up)', async () => {
    await solveWithASTAP(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(mockWcsToCorrespondences).toHaveBeenCalled();
    const args = mockWcsToCorrespondences.mock.calls[0];
    expect(args[1]).toBe(1920); // width
    expect(args[2]).toBe(1080); // height
    expect(args[3]).toBe(true); // fitsYConvention
  });

  // Regression guard: the relaxed quad tolerance `-t 0.020` combined with the
  // thorough search made ASTAP accept scale-distorted false matches. It must NOT
  // be passed; the thorough-search flags (-speed slow, -s 800) are kept.
  it('does not pass the relaxed -t tolerance, but keeps the thorough-search flags', async () => {
    await solveWithASTAP(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');
    const args = mockWrapExecForWSL.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('-wcs'),
    )?.[1] as string[];

    expect(args).not.toContain('-t');
    expect(args).toContain('-speed');
    expect(args[args.indexOf('-speed') + 1]).toBe('slow');
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('800');
  });

  // A sheared CD matrix is a false match — it must be rejected, not turned into a
  // skewed-parallelogram placement.
  it('rejects a distorted (sheared) solution instead of placing it', async () => {
    mockParseFITSHeader.mockReturnValue({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      ...SHEARED_CD,
    });

    const result = await solveWithASTAP(Buffer.from('img'), '.jpg', 1920, 1080, undefined, 'en');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/distorted|shear|déformée|cisaillement/i);
    expect(mockWcsToCorrespondences).not.toHaveBeenCalled();
  });

  it('converts RA/Dec hints to hours and SPD in the ASTAP command', async () => {
    await solveWithASTAP(Buffer.from('img'), '.jpg', 1920, 1080, { ra: 83.6, dec: 22.0 }, 'en');

    const args = mockWrapExecForWSL.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('-wcs'),
    )?.[1] as string[];

    expect(args).toContain('-ra');
    expect(args[args.indexOf('-ra') + 1]).toBe(String(83.6 / 15)); // degrees → hours
    expect(args).toContain('-spd');
    expect(args[args.indexOf('-spd') + 1]).toBe(String(90 + 22.0)); // south pole distance
  });
});
