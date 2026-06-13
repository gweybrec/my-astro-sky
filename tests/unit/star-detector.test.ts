import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectStars, detectStarsFromFile } from '../../src/star-detector';

function makeImageData(width: number, height: number, fill = 0): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = fill;
    data[o + 1] = fill;
    data[o + 2] = fill;
    data[o + 3] = 255;
  }
  return { width, height, data } as unknown as ImageData;
}

function setPixel(img: ImageData, x: number, y: number, value: number): void {
  const idx = (y * img.width + x) * 4;
  img.data[idx] = value;
  img.data[idx + 1] = value;
  img.data[idx + 2] = value;
  img.data[idx + 3] = 255;
}

function addSquare(img: ImageData, cx: number, cy: number, halfSize: number, value: number): void {
  for (let y = cy - halfSize; y <= cy + halfSize; y++) {
    for (let x = cx - halfSize; x <= cx + halfSize; x++) {
      if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
        setPixel(img, x, y, value);
      }
    }
  }
}

describe('detectStars()', () => {
  it('returns no spots for a uniform image', () => {
    const img = makeImageData(120, 80, 10);
    const out = detectStars(img, 1200, 800);

    expect(out.spots).toEqual([]);
    expect(out.imageWidth).toBe(120);
    expect(out.imageHeight).toBe(80);
    expect(out.scaleFromOriginal).toBeCloseTo(10, 8);
  });

  it('detects multiple bright compact spots and sorts by brightness', () => {
    const img = makeImageData(120, 120, 10);

    // 3x3 block (count 9) with different intensities
    addSquare(img, 20, 30, 1, 220);
    addSquare(img, 60, 70, 1, 255);
    addSquare(img, 90, 40, 1, 180);

    const out = detectStars(img, 120, 120);

    expect(out.spots.length).toBeGreaterThanOrEqual(3);

    // Brightness-desc sorting
    for (let i = 1; i < out.spots.length; i++) {
      expect(out.spots[i - 1].brightness).toBeGreaterThanOrEqual(out.spots[i].brightness);
    }

    // Ensure one of the spots is close to the brightest injected blob center
    const nearBright = out.spots.some(
      (s) => Math.abs(s.x - 60) < 2 && Math.abs(s.y - 70) < 2,
    );
    expect(nearBright).toBe(true);
  });

  it('rejects single-pixel noise components', () => {
    const img = makeImageData(120, 120, 10);

    // Isolated hot pixels should be rejected (count < 2)
    setPixel(img, 10, 10, 255);
    setPixel(img, 50, 80, 255);
    setPixel(img, 100, 30, 255);

    const out = detectStars(img, 120, 120);
    expect(out.spots).toEqual([]);
  });

  it('rejects very large bright components as extended objects', () => {
    const img = makeImageData(200, 200, 10);

    // 25x25 block => 625 pixels > maxSpotSize upper clamp (160)
    for (let y = 40; y < 65; y++) {
      for (let x = 40; x < 65; x++) {
        setPixel(img, x, y, 255);
      }
    }

    const out = detectStars(img, 200, 200);
    expect(out.spots).toEqual([]);
  });

  it('caps returned spots to top 40', () => {
    const img = makeImageData(220, 220, 10);

    // Create 45 separate 2-pixel components
    for (let i = 0; i < 45; i++) {
      const x = 4 + (i % 9) * 24;
      const y = 4 + Math.floor(i / 9) * 40;
      // Two adjacent pixels => count=2, valid spot
      setPixel(img, x, y, 200 + (i % 40));
      setPixel(img, x + 1, y, 200 + (i % 40));
    }

    const out = detectStars(img, 220, 220);
    expect(out.spots).toHaveLength(40);
  });
});

describe('detectStarsFromFile()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads image, downsamples to target width, runs detection, and revokes object URL', async () => {
    const file = new File(['abc'], 'test.jpg', { type: 'image/jpeg' });

    const imageData = makeImageData(1000, 500, 10);
    addSquare(imageData, 120, 140, 1, 255);

    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
    };
    const fakeCanvas: any = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    };

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') return fakeCanvas;
      return realCreateElement(tagName as any);
    }) as any);

    const createObjectURL = vi.fn(() => 'blob:ok');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as any);

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4000;
      naturalHeight = 2000;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', FakeImage as any);

    const out = await detectStarsFromFile(file);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ok');
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 1000, 500);
    expect(fakeCanvas.width).toBe(0);
    expect(fakeCanvas.height).toBe(0);

    expect(out.imageWidth).toBe(1000);
    expect(out.imageHeight).toBe(500);
    expect(out.scaleFromOriginal).toBeCloseTo(4, 8);
  });

  it('rejects with translated error and revokes object URL when image load fails', async () => {
    const file = new File(['abc'], 'bad.jpg', { type: 'image/jpeg' });

    const createObjectURL = vi.fn(() => 'blob:error');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as any);

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        this.onerror?.();
      }
    }
    vi.stubGlobal('Image', FailingImage as any);

    await expect(detectStarsFromFile(file)).rejects.toThrow('Failed to load image');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:error');
  });
});
