import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/star-detector', () => ({
  detectStars: vi.fn(),
}));

vi.mock('../../src/api', () => ({
  searchStarsByPosition: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  t: vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

vi.mock('../../src/error-reporter', () => ({
  reportUnknownRendererError: vi.fn(),
}));

import { detectStars } from '../../src/star-detector';
import { searchStarsByPosition } from '../../src/api';
import { reportUnknownRendererError } from '../../src/error-reporter';
import { lightSolve } from '../../src/light-solve';

const mockDetectStars = vi.mocked(detectStars);
const mockSearchStarsByPosition = vi.mocked(searchStarsByPosition);

function fakeImageData(): ImageData {
  return { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) } as unknown as ImageData;
}

describe('lightSolve()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-stars message when detector finds no spots', async () => {
    mockDetectStars.mockReturnValue({ spots: [], imageWidth: 10, imageHeight: 10, scaleFromOriginal: 1 });

    const result = await lightSolve(fakeImageData(), 10, 10);

    expect(result.candidates).toEqual([]);
    expect(result.message).toBe('lightSolve.noStarsDetected');
    expect(mockSearchStarsByPosition).not.toHaveBeenCalled();
  });

  it('returns brightest 10 spots sorted by brightness descending with ranks', async () => {
    const spots = Array.from({ length: 12 }, (_, i) => ({
      x: i,
      y: i + 1,
      brightness: i + 1,
      size: 3,
    }));
    mockDetectStars.mockReturnValue({ spots, imageWidth: 20, imageHeight: 20, scaleFromOriginal: 1 });

    const result = await lightSolve(fakeImageData(), 20, 20);

    expect(result.candidates).toHaveLength(10);
    expect(result.candidates[0].intensity).toBe(12);
    expect(result.candidates[0].rank).toBe(1);
    expect(result.candidates[9].intensity).toBe(3);
    expect(result.candidates[9].rank).toBe(10);
    expect(result.message).toContain('lightSolve.foundStars');
  });

  it('calls catalog API with default radius=5 when hints radius is omitted', async () => {
    mockDetectStars.mockReturnValue({
      spots: [{ x: 1, y: 2, brightness: 100, size: 3 }],
      imageWidth: 10,
      imageHeight: 10,
      scaleFromOriginal: 1,
    });
    mockSearchStarsByPosition.mockResolvedValue([]);

    await lightSolve(fakeImageData(), 10, 10, { ra: 84.05, dec: -1.2 });

    expect(mockSearchStarsByPosition).toHaveBeenCalledOnce();
    expect(mockSearchStarsByPosition).toHaveBeenCalledWith({
      ra: 84.05,
      dec: -1.2,
      radius: 5,
      magLimit: 12,
      limit: 100,
    });
  });

  it('uses explicit hint radius when provided', async () => {
    mockDetectStars.mockReturnValue({
      spots: [{ x: 1, y: 2, brightness: 100, size: 3 }],
      imageWidth: 10,
      imageHeight: 10,
      scaleFromOriginal: 1,
    });
    mockSearchStarsByPosition.mockResolvedValue([]);

    await lightSolve(fakeImageData(), 10, 10, { ra: 10, dec: 20, radius: 1.5 });

    expect(mockSearchStarsByPosition).toHaveBeenCalledWith(
      expect.objectContaining({ radius: 1.5 }),
    );
  });

  it('adds up to 5 suggested stars sorted by magnitude for each candidate', async () => {
    mockDetectStars.mockReturnValue({
      spots: [
        { x: 11, y: 22, brightness: 300, size: 3 },
        { x: 33, y: 44, brightness: 200, size: 3 },
      ],
      imageWidth: 100,
      imageHeight: 100,
      scaleFromOriginal: 1,
    });

    mockSearchStarsByPosition.mockResolvedValue([
      { hip: 1, name: 'A', ra: 84.0, dec: -1.0, mag: 5 },
      { hip: 2, name: 'B', ra: 84.1, dec: -1.1, mag: 2 },
      { hip: 3, name: 'C', ra: 84.2, dec: -1.2, mag: 3 },
      { hip: 4, name: 'D', ra: 84.3, dec: -1.3, mag: 4 },
      { hip: 5, name: 'E', ra: 84.4, dec: -1.4, mag: 1 },
      { hip: 6, name: 'F', ra: 84.5, dec: -1.5, mag: 6 },
    ]);

    const result = await lightSolve(fakeImageData(), 100, 100, { ra: 84.05, dec: -1.2, radius: 2 });

    expect(result.candidates).toHaveLength(2);
    const suggestions = result.candidates[0].suggestedStars;
    expect(suggestions).toBeDefined();
    expect(suggestions).toHaveLength(5);
    expect(suggestions?.map((s) => s.hip)).toEqual([5, 2, 3, 4, 1]);
    expect(typeof suggestions?.[0].distance).toBe('number');
    expect(result.message).toContain('lightSolve.foundWithSuggestions');
  });

  it('falls back to detection-only result when catalog search throws', async () => {
    mockDetectStars.mockReturnValue({
      spots: [{ x: 7, y: 8, brightness: 50, size: 2 }],
      imageWidth: 100,
      imageHeight: 100,
      scaleFromOriginal: 1,
    });
    mockSearchStarsByPosition.mockRejectedValue(new Error('network down'));

    const result = await lightSolve(fakeImageData(), 100, 100, { ra: 10, dec: 20 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].suggestedStars).toBeUndefined();
    expect(result.message).toContain('lightSolve.foundStars');
    expect(reportUnknownRendererError).toHaveBeenCalledWith('light_solve_catalog_search', expect.any(Error));
  });
});
