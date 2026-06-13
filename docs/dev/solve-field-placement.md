# solve-field Placement: Coordinate Conventions and EXIF Orientation

## How placement works

When solve-field solves a JPEG/PNG, it writes a `.wcs` FITS file containing the WCS (World Coordinate System) solution. `server/wcs-reader.ts` then inverts this solution to produce **star correspondences**: pairs of `(photoX, photoY)` ↔ `(RA, Dec)` that tell the frontend affine transform where to place the image on the sky map.

Two independent coordinate-system issues must be handled correctly:

1. **Y-axis convention** in the WCS solution  
2. **EXIF orientation** of the source JPEG

---

## 1. Y-axis convention: `fitsYConvention=false`

`wcsToCorrespondences(wcs, w, h, fitsYConvention)` converts sky coordinates back to image pixels. The `fitsYConvention` flag controls how FITS pixel coordinates map to display (screen) coordinates:

| Convention | Y=1 at… | Who uses it |
|---|---|---|
| `fitsYConvention=true` | **bottom** of image | PixInsight/Siril FITS files |
| `fitsYConvention=false` | **top** of image | solve-field output for JPEG/PNG input |

**solve-field always writes its `.wcs` with Y=1 at the top row** when the input is a JPEG or PNG (the natural storage order of those formats). Therefore `server/solve-field.ts` passes `false` unconditionally:

```typescript
// solve-field receives a JPEG/PNG (screen/display convention):
// pixel (1,1) = upper-left, Y increases downward → fitsYConvention=false
const correspondences = wcsToCorrespondences(wcs, width, height, false);
```

The input to solve-field is **always** a JPEG or PNG (never a raw FITS file), so this value never needs to change.

---

## 2. EXIF orientation correction

Astrophoto JPEGs often carry an EXIF orientation tag (e.g., images from camera phones or export pipelines). Browsers apply this tag automatically, displaying the image in the corrected orientation. The CSS matrix transform in `src/photo-overlay.ts` therefore operates in **browser-display coordinates**, not raw pixel coordinates.

solve-field reads the JPEG raw pixel data **without** applying EXIF rotation. Its WCS solution and the resulting `(photoX, photoY)` correspondences are in **raw pixel coordinates**.

`rawToBrowserCoords` in `server/index.ts` bridges the gap, converting raw pixel coords to browser-display coords after solving.

### Orientation formulas

For raw image dimensions `rawW × rawH` (0-indexed):

| EXIF value | Meaning | Correct formula |
|---|---|---|
| 1 | Normal, no rotation | `(rawX, rawY)` |
| 2 | Mirror horizontal | `(rawW-1-rawX, rawY)` |
| 3 | 180° rotation | `(rawW-1-rawX, rawH-1-rawY)` |
| 4 | Mirror vertical | `(rawX, rawH-1-rawY)` |
| 5 | Transpose | `(rawY, rawX)` |
| 6 | 90° CW | `(rawH-1-rawY, rawX)` |
| 7 | Anti-transpose | `(rawH-1-rawY, rawW-1-rawX)` |
| 8 | 90° CCW (270° CW) | `(rawY, rawW-1-rawX)` |

### Where this correction is applied

The correction is applied in two places in `server/index.ts`, once for ASTAP and once for solve-field, immediately after the solver returns:

```typescript
if (result.success && result.correspondences && meta.orientation && meta.orientation !== 1) {
  result.correspondences = result.correspondences.map(c => {
    const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, meta.orientation!);
    return { ...c, photoX: x, photoY: y };
  });
}
```

---

## Diagnostic: does a new image place correctly?

If a newly solved image appears misaligned, check in order:

1. **180° rotation (or "double mirror")** → EXIF orientation issue. Check `meta.orientation` via `sharp(buffer).metadata()`. If it is 6 or 8, verify `rawToBrowserCoords` with the table above.

2. **Vertical flip only** → wrong `fitsYConvention`. For solve-field + JPEG this should never happen (always `false`), but for ASTAP or metadata extraction from FITS, verify the flag passed to `wcsToCorrespondences`.

3. **Slight rotation/scale error but correct region** → SIP distortion coefficients not being applied (the WCS has higher-order corrections that we currently skip).

4. **Completely wrong region of sky** → solve-field found a false match. Re-run with a tighter RA/Dec hint.
