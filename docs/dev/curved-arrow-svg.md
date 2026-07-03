# Curved-arrow SVG construction

This document explains the geometry used to draw the rotation-button icons (`src/icons/rotate-*.svg`), so the same approach can be applied to any circular-arc arrow.

---

## The problem with naïve arrowheads

A circular arc arrow has an arrowhead at one end. If you place the arrowhead by simply picking two symmetric wing points relative to the tip, the result looks wrong: one wing sits too close to the arc body and the other too far away. This is because the arc curves toward one wing and away from the other.

The fix is to orient the arrowhead so its **axis of symmetry bisects the arc stroke** — that is, the midpoint of the two wing tips lies on the arc centreline.

---

## Coordinate system

All rotation icons use a circular arc with:

- **Centre** C = (18, 12)
- **Radius** r = 8
- **Start** (18, 4) — 12 o'clock
- **Direction** clockwise (SVG sweep-flag = 1)

A point on the arc at angle θ measured clockwise from 12 o'clock:

```
P(θ) = ( 18 + 8·sin θ,  12 − 8·cos θ )
```

Verification: θ=0 → (18, 4) ✓ θ=90° → (26, 12) ✓ θ=180° → (18, 20) ✓

---

## Why moving along the tangent is wrong

The clockwise **tangent** at P(θ) is:

```
t̂(θ) = ( cos θ,  sin θ )
```

If you place the wing midpoint M by moving L units backward along the tangent from the tip T:

```
M_tangent = T − L · t̂
```

M_tangent is **not** on the arc. The distance from C to M_tangent grows with L:

```
|M_tangent − C|² = r² + L²   (always > r²)
```

This places M outside the arc, so the visual midpoint of the arrowhead aligns with the outer edge of the stroke rather than its centre.

---

## Correct approach: walk back along the arc

Instead, choose M as a point Δθ earlier on the arc:

```
M = P(θ_end − Δθ) = ( 18 + 8·sin(θ_end − Δθ),  12 − 8·cos(θ_end − Δθ) )
```

M is exactly on the arc centreline by construction (`|M − C| = r`).

### Arrowhead axis

The axis direction is the chord from M to T, normalised:

```
a = T − M
â = a / |a|
```

For small Δθ this closely approximates the tangent at T, but because it runs between two arc points it stays aligned with the stroke.

### Wing points

The perpendicular to the axis (rotate â by 90° CCW in SVG coords):

```
p̂ = ( −â.y,  â.x )
```

Wing points at half-width W on each side of M:

```
Wing1 = M + W · p̂
Wing2 = M − W · p̂
```

The full SVG path for the arrowhead:

```
M {Wing1.x},{Wing1.y} L {T.x},{T.y} L {Wing2.x},{Wing2.y}
```

---

## Worked example — `rotate-p5.svg` (90° arc, tip at 3 o'clock)

**Parameters:** Δθ = 25°, W = 2.5, T = (26, 12) (θ_end = 90°)

**Step 1 — find M** (θ_M = 65°):

```
M = ( 18 + 8·sin 65°,  12 − 8·cos 65° )
  = ( 18 + 7.250,  12 − 3.381 )
  = ( 25.25,  8.62 )
```

Check: `|(25.25−18, 8.62−12)| = |(7.25, −3.38)| = √(52.56+11.43) = √64.0 = 8` ✓

**Step 2 — axis direction:**

```
a = (26−25.25, 12−8.62) = (0.75, 3.38)
|a| = √(0.56+11.42) = 3.46
â = (0.217, 0.976)
```

**Step 3 — perpendicular:**

```
p̂ = (−0.976, 0.217)
```

**Step 4 — wings (W = 2.5):**

```
Wing1 = (25.25 − 2.44,  8.62 + 0.54) = (22.8, 9.2)
Wing2 = (25.25 + 2.44,  8.62 − 0.54) = (27.7, 8.1)
```

**Result:** `M 22.8,9.2 L 26,12 L 27.7,8.1`

---

## Parameter choice

The icons use **Δθ = 25°** and **W = 2.5**, giving:

| Quantity                  | Value                 |
| ------------------------- | --------------------- |
| Arc-chord depth `\|M−T\|` | ≈ 3.5 px (for r = 8)  |
| Half-width W              | 2.5 px                |
| Wing-to-tip distance      | √(3.5²+2.5²) ≈ 4.3 px |
| Opening half-angle        | arctan(2.5/3.5) ≈ 35° |

For a different circle radius r, scale Δθ or W proportionally to keep the arrowhead visually balanced relative to the arc.

---

## All computed endpoints

| File         | θ_end | θ_M  | T            | M            | Wing1        | Wing2        |
| ------------ | ----- | ---- | ------------ | ------------ | ------------ | ------------ |
| `rotate-p1`  | 40°   | 15°  | (23.1, 5.9)  | (20.1, 4.3)  | (18.9, 6.5)  | (21.3, 2.1)  |
| `rotate-p5`  | 90°   | 65°  | (26.0, 12.0) | (25.3, 8.6)  | (22.8, 9.2)  | (27.7, 8.1)  |
| `rotate-p15` | 150°  | 125° | (22.0, 18.9) | (24.6, 16.6) | (22.9, 14.7) | (26.2, 18.4) |
| `rotate-p45` | 240°  | 215° | (11.1, 16.0) | (13.4, 18.6) | (15.3, 16.9) | (11.6, 20.2) |

The `rotate-m*` icons mirror each `rotate-p*` icon with `transform="matrix(-1,0,0,1,36,0)"` and use identical arrowhead coordinates inside the group.

---

## Reusable formula (any circle)

Given a clockwise circular arc with centre C, radius r, and endpoint T:

```
θ_end  = atan2( T.x − C.x,  −(T.y − C.y) )   # angle CW from 12 o'clock
θ_M    = θ_end − Δθ                             # step back along the arc
M      = ( C.x + r·sin θ_M,  C.y − r·cos θ_M )
â      = normalise( T − M )
p̂      = ( −â.y,  â.x )
Wing1  = M + W · p̂
Wing2  = M − W · p̂
```

For a **counter-clockwise** arc, reverse the sign of Δθ (`θ_M = θ_end + Δθ`) and flip the perpendicular (`p̂ = (â.y, −â.x)`).
