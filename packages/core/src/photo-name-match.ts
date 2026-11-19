/** Remove the last file extension from a filename (e.g. "M1.fit" → "M1"). */
export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * The photo whose name is the file's name without its extension ("M101.fit" finds the photo "M101").
 * Exact and case-sensitive; a photo renamed since it was added no longer matches.
 */
export function findPhotoWithFileName<T extends { originalName: string }>(
  fileName: string,
  photos: readonly T[],
): T | undefined {
  const name = stripExtension(fileName);
  return photos.find((photo) => photo.originalName === name);
}
