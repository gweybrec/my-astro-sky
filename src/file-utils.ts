/** Remove the last file extension from a filename (e.g. "M1.fit" → "M1"). */
export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/** Resolve the pixel dimensions of an image File. Returns {width:0, height:0} if unreadable. */
export function getFileDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
