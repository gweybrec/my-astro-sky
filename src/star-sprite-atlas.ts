/**
 * Star sprite atlas: pre-rendered offscreen canvases for each quantized (mag, bv)
 * bucket at the current zoom. Extracted from `sky-map.ts` so its rebuild policy —
 * the part with real decisions in it — can be unit-tested without a canvas.
 *
 * Building a sprite bakes a ~15-stop radial gradient, so rebuilding the whole atlas
 * every frame would churn hundreds of canvases and drive the GC. Instead the atlas is
 * keyed on a quantized zoom bucket and *frozen* during a gesture; between rebuilds the
 * frozen sprites are scaled to the live zoom with `drawImage`, which is cheap.
 *
 * The rebuild is throttled by **scale drift** rather than by time. That bounds how far
 * a frozen sprite is upscaled (and thus how pixelated it looks) directly, and is
 * self-limiting: each rebuild resets the drift to ~1, so a continuous zoom rebuilds
 * once per ~1.3x step regardless of frame rate — no time-floor feedback loop.
 */
import { atlasScaleBucket } from './star-render-math';

/** One baked sprite: the offscreen canvas and half its size (its centre offset). */
export interface StarSprite {
  canvas: HTMLCanvasElement;
  half: number;
}

/**
 * During a gesture the frozen atlas is rebuilt once the live zoom drifts past this
 * radius ratio from it — bounding how much `drawImage` upscales (and thus pixelates)
 * a frozen sprite, while a continuous zoom rebuilds only once per such step rather
 * than every frame.
 */
export const ATLAS_REBUILD_RATIO = 1.3;

/** What the render pass needs to know about the atlas state for this frame. */
export interface AtlasFrame {
  /** Factor to scale frozen sprites by to track the live zoom; 1 when crisp. */
  spriteScale: number;
  /** True when the sprites are frozen and being rescaled (not drawn 1:1). */
  frozen: boolean;
  /** The magnitude limit the sprites were baked at. */
  builtMaxMag: number;
  /** The zoom scale the sprites were baked at. */
  builtScale: number;
}

export class StarSpriteAtlas {
  private sprites = new Map<number, StarSprite>();
  private builtScale = -1;
  private builtMaxMag = -1;

  /** Number of baked sprites (diagnostics and tests). */
  get size(): number {
    return this.sprites.size;
  }

  /**
   * Decide whether to rebuild for this frame, clearing the atlas if so, and report
   * how the render pass should draw.
   *
   * Rebuild a crisp atlas: always at rest or when empty; during a gesture, only once
   * the live zoom has drifted past {@link ATLAS_REBUILD_RATIO} from the frozen atlas.
   */
  beginFrame(scale: number, maxMag: number, interacting: boolean): AtlasFrame {
    const bucket = atlasScaleBucket(scale);
    const roundedMaxMag = Math.round(maxMag * 10) / 10;
    const stale = bucket !== this.builtScale || roundedMaxMag !== this.builtMaxMag;

    // How much the frozen sprites would be scaled to track the current zoom.
    const liveRatio = this.builtScale > 0 ? Math.sqrt(scale / this.builtScale) : 1;
    const drifted = liveRatio > ATLAS_REBUILD_RATIO || liveRatio < 1 / ATLAS_REBUILD_RATIO;

    if (stale && (!interacting || this.sprites.size === 0 || drifted)) {
      this.sprites.clear();
      this.builtScale = bucket;
      this.builtMaxMag = roundedMaxMag;
    }

    // Just-rebuilt frames draw crisp 1:1 (bucket matches); between rebuilds, scale the
    // frozen sprites by the radius ratio (~sqrt of the scale ratio, matching starRadius'
    // curve). At rest and during a pan the bucket matches, so this stays 1.
    const frozen = this.builtScale !== bucket;
    const spriteScale = frozen && this.builtScale > 0 ? Math.sqrt(scale / this.builtScale) : 1;

    return { spriteScale, frozen, builtMaxMag: this.builtMaxMag, builtScale: this.builtScale };
  }

  /**
   * The sprite for a bucket key, baking it via `build` on first use. A sprite minted
   * mid-gesture (a newly-appeared bucket) is built at the atlas's *frozen* scale and
   * magnitude — passed to `build` — so it matches the rest of the atlas and rescales
   * identically rather than popping at a different size.
   */
  spriteFor(
    key: number,
    build: (builtScale: number, builtMaxMag: number) => StarSprite,
  ): StarSprite {
    let sprite = this.sprites.get(key);
    if (sprite === undefined) {
      sprite = build(this.builtScale, this.builtMaxMag);
      this.sprites.set(key, sprite);
    }
    return sprite;
  }

  /** Quantize (mag, bv) to a sprite bucket: 0.25-mag and ~1/12 B-V steps. */
  static bucketKey(mag: number, bv: number): number {
    const magKey = Math.round(mag * 4);
    const bvKey = Math.round((Math.max(-0.4, Math.min(2.0, bv)) + 0.4) * 12);
    return magKey * 100 + bvKey;
  }
}
