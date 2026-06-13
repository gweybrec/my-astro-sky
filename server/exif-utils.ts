/**
 * EXIF orientation correction: maps raw sensor pixel coordinates to
 * browser-display pixel coordinates based on the EXIF orientation tag.
 *
 * solve-field operates on the raw JPEG bytes (no EXIF rotation applied),
 * so correspondences returned from the solver are in raw pixel space.
 * This function converts them to the coordinate space the browser uses
 * when displaying the image (which respects EXIF rotation).
 *
 * @param rawX  - X pixel in raw (sensor) coordinates
 * @param rawY  - Y pixel in raw (sensor) coordinates
 * @param rawW  - raw image width in pixels
 * @param rawH  - raw image height in pixels
 * @param orientation - EXIF orientation tag value (1–8); defaults to identity
 */
export function rawToBrowserCoords(
  rawX: number, rawY: number,
  rawW: number, rawH: number,
  orientation: number
): { x: number; y: number } {
  switch (orientation) {
    case 2: return { x: rawW - 1 - rawX, y: rawY };
    case 3: return { x: rawW - 1 - rawX, y: rawH - 1 - rawY };
    case 4: return { x: rawX, y: rawH - 1 - rawY };
    case 5: return { x: rawY, y: rawX };
    case 6: return { x: rawH - 1 - rawY, y: rawX };          // 90° CW
    case 7: return { x: rawH - 1 - rawY, y: rawW - 1 - rawX };
    case 8: return { x: rawY, y: rawW - 1 - rawX };          // 90° CCW (270° CW)
    default: return { x: rawX, y: rawY }; // orientation 1 or unknown
  }
}
