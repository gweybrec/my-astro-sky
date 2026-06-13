export interface DeleteOptions {
  photoMetadata: boolean;
  dsoOverrides: boolean;
  customGear: boolean;
  gearSetups: boolean;
  photoIds: string[];
  /** Total number of photos in the map (used for "all N" vs "N of total" wording). */
  totalPhotos: number;
}


export function buildDeleteSummaryLines(
  opts: DeleteOptions,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const lines: string[] = [];

  if (opts.photoMetadata) {
    lines.push(t('settings.deleteSummaryPhotoMeta'));
  }

  if (opts.dsoOverrides) {
    lines.push(t('settings.deleteSummaryDsoOverrides'));
  }

  if (opts.customGear) {
    lines.push(t('settings.deleteSummaryCustomGear'));
  }

  if (opts.gearSetups) {
    lines.push(t('settings.deleteSummaryGearSetups'));
  }

  if (opts.photoIds.length > 0) {
    const n = opts.photoIds.length;
    const total = opts.totalPhotos;
    if (n >= total && total > 0) {
      lines.push(
        t('settings.deleteSummaryPhotosAll').replace('{n}', String(n)),
      );
    } else {
      lines.push(
        t('settings.deleteSummaryPhotosPartial')
          .replace('{n}', String(n))
          .replace('{total}', String(total)),
      );
    }
  }

  return lines;
}
