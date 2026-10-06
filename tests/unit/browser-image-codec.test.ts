// @vitest-environment node
/** The phone codec's `convertToBlob` workaround: an animation-frame loop runs during the call, then stops. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserImageCodec } from '@myastrosky/backend-local/browser-image-codec';

class FakeCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return { putImageData: () => undefined };
  }
  convertToBlob = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])]));
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

const raw = { width: 1, height: 1, channels: 4 as const, data: new Uint8Array(4) };

describe('browser image codec: convertToBlob', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs a requestAnimationFrame loop during the call and stops it after', async () => {
    const pending: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      pending.push(cb);
      return pending.length;
    });
    let during = 0;
    class Canvas extends FakeCanvas {
      convertToBlob = vi.fn(async () => {
        // Let the loop turn a few times while the call is pending.
        for (let i = 0; i < 3; i++) pending.splice(0).forEach((cb) => cb(0));
        during = raf.mock.calls.length;
        return new Blob([new Uint8Array([1])]);
      });
    }
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('OffscreenCanvas', Canvas);
    vi.stubGlobal('ImageData', FakeImageData);

    const out = await createBrowserImageCodec().encode(raw, 'png');
    expect(Array.from(out)).toEqual([1]);
    expect(during).toBeGreaterThan(1);

    const afterCall = raf.mock.calls.length;
    pending.splice(0).forEach((cb) => cb(0));
    expect(raf.mock.calls.length).toBe(afterCall);
  });

  it('works when requestAnimationFrame does not exist', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('ImageData', FakeImageData);
    const out = await createBrowserImageCodec().encode(raw, 'png');
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});
