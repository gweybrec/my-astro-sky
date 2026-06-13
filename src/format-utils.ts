export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRA(raDeg: number): string {
  const raH = raDeg / 15;
  const h = Math.floor(raH);
  const m = Math.floor((raH - h) * 60);
  const s = ((raH - h) * 60 - m) * 60;
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}

export function formatDec(decDeg: number): string {
  const sign = decDeg >= 0 ? '+' : '−';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${sign}${d}° ${m.toString().padStart(2, '0')}' ${s.toFixed(0).padStart(2, '0')}"`;
}

export function formatSize(majAxis: number | null, minAxis: number | null): string {
  if (majAxis === null) return '—';
  const maj = majAxis >= 1 ? `${majAxis.toFixed(1)}'` : `${(majAxis * 60).toFixed(0)}"`;
  if (minAxis === null || Math.abs(majAxis - minAxis) < 0.1) return maj;
  const min = minAxis >= 1 ? `${minAxis.toFixed(1)}'` : `${(minAxis * 60).toFixed(0)}"`;
  return `${maj} × ${min}`;
}

export function formatRating(rating: number | null): string {
  if (rating === null) return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export function formatDifficulty(difficulty: number | null): string {
  if (difficulty === null) return '';
  return '◆'.repeat(difficulty) + '◇'.repeat(5 - difficulty);
}
