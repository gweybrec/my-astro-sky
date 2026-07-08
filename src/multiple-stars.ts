import type { DSO, StarMultiplicity } from './types';
import type { GearPreset } from './gear-presets';
import { resolvingLimitArcsec } from './gear-presets';
import { getStarByHip, getMultipleSystems, starDisplayName } from './star-catalog';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * How "comfortable" a separation is to enjoy as a visual double: very tight pairs are
 * hard, very wide ones read as two unrelated stars. Peaks across ≈3–60″, ramping in from
 * 1″ and tapering out past 60″. Returns 0..1.
 */
function sepComfort(sepArcsec: number): number {
  if (sepArcsec <= 1) return 0;
  if (sepArcsec < 3) return (sepArcsec - 1) / 2; // 1″→3″ ramps 0→1
  if (sepArcsec <= 60) return 1;
  if (sepArcsec >= 300) return 0.3;
  return 1 - (0.7 * (sepArcsec - 60)) / 240; // 60″→300″ ramps 1→0.3
}

/**
 * Rating (0–5★) for a double/multiple star as an observing target, from the two brightest
 * components. Combines colour contrast (|ΔB−V|), brightness balance (small Δmag), and a
 * comfortable separation. **Setup-aware**: if the pair is tighter than the setup can
 * resolve (`resolvingLimit`), it can't be recorded, so the rating is **0**.
 *
 * Tuned to the reference anchors: Albireo (big colour, balanced, 34″) → 5; Sirius (no
 * colour contrast, Δmag ≈ 10) → 1.
 */
export function multipleStarRating(
  bvA: number,
  bvB: number,
  magA: number,
  magB: number,
  sepArcsec: number,
  resolvingLimit: number,
): number {
  if (sepArcsec < resolvingLimit) return 0; // unresolvable with this setup

  const colour = clamp01(Math.abs(bvA - bvB) / 1.2); // ≈1.2 mag of B−V = max contrast
  const balance = clamp01(1 - (Math.abs(magA - magB) - 1) / 5); // Δmag ≤1 → 1, ≥6 → 0
  const comfort = sepComfort(sepArcsec);

  const blend = 0.5 * colour + 0.3 * balance + 0.2 * comfort;
  return Math.max(1, Math.min(5, Math.round(blend * 5)));
}

/**
 * Build synthetic `DSO` targets (type `'MS'`) for the curated multiple-star systems, with a
 * setup-dependent rating. Injected into the Targets recommender pool. The companion's
 * photometry comes from a catalogued member HIP, else the curated `magB`/`bvB`.
 */
export function buildMultipleStarTargets(preset: GearPreset): DSO[] {
  const limit = resolvingLimitArcsec(preset);
  const out: DSO[] = [];

  for (const [hipStr, e] of Object.entries(getMultipleSystems())) {
    const hip = Number(hipStr);
    const primary = getStarByHip(hip);
    if (!primary) continue;

    const member = e.members?.[0] != null ? getStarByHip(e.members[0]) : undefined;
    const magB = member ? member.mag : e.magB;
    const bvB = member ? member.bv : e.bvB;
    const sep = e.sep ? parseFloat(e.sep) : NaN;

    const rating =
      magB != null && bvB != null && !Number.isNaN(sep)
        ? multipleStarRating(primary.bv, bvB, primary.mag, magB, sep, limit)
        : null;

    const multiplicity: StarMultiplicity = { components: e.components };
    if (e.sep) multiplicity.sep = e.sep;

    // Secondary designation shown after the name on the card. Pick the first Bayer/
    // Flamsteed designation that isn't already the display name (so an unnamed star like
    // "ε1 Lyr" doesn't render as "ε1 Lyr ε1 Lyr"), else fall back to the HIP number.
    const displayName = starDisplayName(primary);
    const desigs: string[] = [];
    if (primary.bayer && primary.constellation)
      desigs.push(`${primary.bayer} ${primary.constellation}`);
    if (primary.flam && primary.constellation)
      desigs.push(`${primary.flam} ${primary.constellation}`);
    const secondaryId = desigs.find((d) => d !== displayName) ?? `HIP ${hip}`;

    out.push({
      id: `star:${hip}`,
      ra: primary.ra,
      dec: primary.dec,
      type: 'MS',
      majAxis: null,
      minAxis: null,
      pa: 0,
      mag: primary.mag,
      displayName,
      catalogs: [secondaryId],
      emissionLines: null,
      constellation: primary.constellation ?? null,
      rating,
      difficulty: null,
      containerId: null,
      priority: 0,
      multiplicity,
    });
  }

  return out;
}
