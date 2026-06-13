// Web Worker: generates low-res thumbnail blobs off the main thread.
// Receives: { id: string; file: File; maxWidth: number }
// Responds: { id: string; blob: Blob } | { id: string; error: string }

self.onmessage = async (e: MessageEvent<{ id: string; file: File; maxWidth: number }>) => {
  const { id, file, maxWidth } = e.data;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: String(err instanceof Error ? err.message : err) });
  }
};
