import { describe, expect, it, vi } from 'vitest';

import { StarSpriteAtlas, ATLAS_REBUILD_RATIO, type StarSprite } from '../../src/star-sprite-atlas';
import { atlasScaleBucket } from '../../src/star-render-math';

/**
 * The sprite-atlas rebuild policy. Baking a sprite draws a ~15-stop gradient, so the
 * atlas is frozen during a gesture and its sprites rescaled with drawImage instead.
 * The throttle is on *scale drift*, not time — which bounds how pixelated a frozen
 * sprite can get, and is self-limiting (each rebuild resets the drift).
 */

/** A stand-in sprite; the real one bakes a canvas, which we never need here. */
const fakeSprite = (): StarSprite => ({ canvas: {} as HTMLCanvasElement, half: 4 });

/** A scale that is `steps` atlas buckets away from `from`. */
function scaleAfterRatio(from: number, ratio: number): number {
  return from * ratio;
}

describe('StarSpriteAtlas', () => {
  describe('rebuild policy', () => {
    it('builds on the first frame and draws crisp', () => {
      const a = new StarSpriteAtlas();
      const f = a.beginFrame(600, 8, false);
      expect(f.spriteScale).toBe(1);
      expect(f.frozen).toBe(false);
      expect(f.builtScale).toBe(atlasScaleBucket(600));
      expect(f.builtMaxMag).toBe(8);
    });

    it('reuses the atlas across a pan (same bucket, same limit)', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);
      expect(a.size).toBe(1);
      a.beginFrame(600, 8, false);
      expect(a.size).toBe(1); // not cleared
    });

    it('rebuilds at rest as soon as the zoom bucket changes', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);
      const f = a.beginFrame(1200, 8, false);
      expect(a.size).toBe(0); // cleared
      expect(f.frozen).toBe(false);
      expect(f.spriteScale).toBe(1);
    });

    it('rebuilds at rest when the magnitude limit changes', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);
      a.beginFrame(600, 9, false);
      expect(a.size).toBe(0);
    });

    it('rounds the magnitude limit to 0.1 before comparing', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8.0, false);
      a.spriteFor(1, fakeSprite);
      a.beginFrame(600, 8.04, false); // rounds to 8.0 — no rebuild
      expect(a.size).toBe(1);
      a.beginFrame(600, 8.06, false); // rounds to 8.1 — rebuild
      expect(a.size).toBe(0);
    });

    it('freezes the atlas during a gesture and rescales instead of rebuilding', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);

      // A small zoom step mid-gesture: sprites stay, and get scaled to track the zoom.
      const f = a.beginFrame(660, 8, true);
      expect(a.size).toBe(1); // not cleared
      expect(f.frozen).toBe(true);
      expect(f.spriteScale).toBeGreaterThan(1);
      expect(f.spriteScale).toBeLessThan(ATLAS_REBUILD_RATIO);
    });

    it('rebuilds mid-gesture once the zoom drifts past the ratio', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);

      // spriteScale is sqrt(scale ratio), so drifting past ATLAS_REBUILD_RATIO in
      // radius needs a scale ratio of ratio².
      const far = scaleAfterRatio(600, ATLAS_REBUILD_RATIO ** 2 * 1.2);
      const f = a.beginFrame(far, 8, true);
      expect(a.size).toBe(0); // rebuilt despite the gesture
      expect(f.spriteScale).toBe(1);
      expect(f.frozen).toBe(false);
    });

    it('rebuilds mid-gesture when zoomed far OUT as well as far in', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);
      const near = 600 / (ATLAS_REBUILD_RATIO ** 2 * 1.2);
      a.beginFrame(near, 8, true);
      expect(a.size).toBe(0);
    });

    it('builds mid-gesture when the atlas is empty', () => {
      const a = new StarSpriteAtlas();
      const f = a.beginFrame(600, 8, true); // first frame ever, mid-gesture
      expect(f.spriteScale).toBe(1);
      expect(f.frozen).toBe(false);
    });

    it('is self-limiting: each rebuild resets the drift to 1', () => {
      const a = new StarSpriteAtlas();
      let scale = 600;
      let rebuilds = 0;
      a.beginFrame(scale, 8, false);
      a.spriteFor(1, fakeSprite);
      // Zoom continuously by 2% a frame over 200 frames (≈ 50x total).
      for (let i = 0; i < 200; i++) {
        scale *= 1.02;
        const before = a.size;
        a.beginFrame(scale, 8, true);
        if (a.size === 0 && before > 0) rebuilds++;
        a.spriteFor(1, fakeSprite);
      }
      // Far fewer rebuilds than frames — the point of the drift throttle.
      expect(rebuilds).toBeGreaterThan(0);
      expect(rebuilds).toBeLessThan(20);
    });
  });

  describe('spriteFor', () => {
    it('bakes once per key and caches', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      const build = vi.fn(fakeSprite);
      const first = a.spriteFor(42, build);
      const second = a.spriteFor(42, build);
      expect(build).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('bakes a mid-gesture sprite at the FROZEN scale, not the live one', () => {
      // Otherwise a bucket that first appears mid-zoom would be baked at a different
      // size from the rest of the atlas and pop when the whole atlas is rescaled.
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      a.spriteFor(1, fakeSprite);
      a.beginFrame(660, 8, true); // frozen at the 600 bucket

      const build = vi.fn((scale: number, maxMag: number) => {
        expect(scale).toBe(atlasScaleBucket(600));
        expect(maxMag).toBe(8);
        return fakeSprite();
      });
      a.spriteFor(2, build);
      expect(build).toHaveBeenCalledTimes(1);
    });

    it('re-bakes after a rebuild clears the atlas', () => {
      const a = new StarSpriteAtlas();
      a.beginFrame(600, 8, false);
      const build = vi.fn(fakeSprite);
      a.spriteFor(42, build);
      a.beginFrame(1200, 8, false);
      a.spriteFor(42, build);
      expect(build).toHaveBeenCalledTimes(2);
    });
  });

  describe('bucketKey', () => {
    it('quantizes magnitude to 0.25 steps', () => {
      expect(StarSpriteAtlas.bucketKey(3.0, 0.5)).toBe(StarSpriteAtlas.bucketKey(3.1, 0.5));
      expect(StarSpriteAtlas.bucketKey(3.0, 0.5)).not.toBe(StarSpriteAtlas.bucketKey(3.3, 0.5));
    });

    it('quantizes B-V to ~1/12 steps', () => {
      expect(StarSpriteAtlas.bucketKey(3, 0.5)).toBe(StarSpriteAtlas.bucketKey(3, 0.52));
      expect(StarSpriteAtlas.bucketKey(3, 0.5)).not.toBe(StarSpriteAtlas.bucketKey(3, 0.7));
    });

    it('clamps B-V to the [-0.4, 2.0] range so extremes share a bucket', () => {
      expect(StarSpriteAtlas.bucketKey(3, -5)).toBe(StarSpriteAtlas.bucketKey(3, -0.4));
      expect(StarSpriteAtlas.bucketKey(3, 99)).toBe(StarSpriteAtlas.bucketKey(3, 2.0));
    });

    it('separates magnitude and colour so distinct buckets never collide', () => {
      // Every distinct (magnitude bucket, colour bucket) pair must map to its own key —
      // a collision would make two differently-coloured stars share one sprite.
      const byKey = new Map<number, string>();
      for (let mag = 0; mag < 12; mag += 0.25) {
        for (let bv = -0.4; bv <= 2.0; bv += 1 / 12) {
          const key = StarSpriteAtlas.bucketKey(mag, bv);
          const bucket = `${Math.round(mag * 4)}/${Math.round((bv + 0.4) * 12)}`;
          const prev = byKey.get(key);
          if (prev !== undefined) expect(prev).toBe(bucket);
          byKey.set(key, bucket);
        }
      }
      expect(byKey.size).toBeGreaterThan(1000);
    });
  });
});
