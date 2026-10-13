import type {
  CaptureDetails,
  Photo,
  PhotoIntegration,
  PlateSolveResult,
  PointOfInterest,
} from './types';
import { sanitizeCaptureDetails } from './capture-fields';

/**
 * The editable copy of a photo's metadata, as the "edit metadata" form of the desktop and of the phone hold it while
 * the user types: nothing is saved before `draftToMetadata` is sent.
 */
export interface PhotoMetadataDraft {
  displayName: string;
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  /** UTC ISO 8601, or '' when the photo has no date. */
  observationDate: string;
  captureDetails: CaptureDetails;
  gearSetupId: string | null;
  notes: string;
}

/** Whole, non-negative frame counts and exposures (anything else becomes 0, "not given"), trimmed filter names. */
export function sanitizeIntegrations(rows: PhotoIntegration[]): PhotoIntegration[] {
  const whole = (value: unknown) =>
    Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  return rows.map((row) => ({
    frames: whole(row.frames),
    seconds: whole(row.seconds),
    filter: row.filter.trim(),
  }));
}

/** A draft of the photo's metadata; it shares no array or object with the photo. */
export function draftFromPhoto(photo: Photo): PhotoMetadataDraft {
  return {
    displayName: photo.originalName,
    dsoIds: [...photo.dsoIds],
    labels: [...photo.labels],
    pointsOfInterest: (photo.pointsOfInterest ?? []).map((p) => ({ ...p })),
    integrations: sanitizeIntegrations(photo.integrations ?? []),
    observationDate: photo.observationDate ?? '',
    captureDetails: sanitizeCaptureDetails(photo.captureDetails ?? {}),
    gearSetupId: photo.gearSetupId ?? null,
    notes: photo.notes ?? '',
  };
}

/** Whether the draft differs from the one the form started with (the form then asks before it is left). */
export function isDraftDirty(draft: PhotoMetadataDraft, original: PhotoMetadataDraft): boolean {
  if (draft.displayName !== original.displayName) return true;
  if (draft.observationDate !== original.observationDate) return true;
  if (draft.gearSetupId !== original.gearSetupId) return true;
  if (
    JSON.stringify(sanitizeCaptureDetails(draft.captureDetails)) !==
    JSON.stringify(original.captureDetails)
  )
    return true;
  if (draft.notes !== original.notes) return true;
  if (
    draft.dsoIds.length !== original.dsoIds.length ||
    draft.dsoIds.some((v, i) => v !== original.dsoIds[i])
  )
    return true;
  if (
    draft.labels.length !== original.labels.length ||
    draft.labels.some((v, i) => v !== original.labels[i])
  )
    return true;
  if (
    draft.pointsOfInterest.length !== original.pointsOfInterest.length ||
    draft.pointsOfInterest.some(
      (v, i) =>
        v.name !== original.pointsOfInterest[i].name ||
        v.categoryId !== original.pointsOfInterest[i].categoryId,
    )
  )
    return true;
  if (draft.integrations.length !== original.integrations.length) return true;
  return draft.integrations.some((a, i) => {
    const b = original.integrations[i];
    return a.frames !== b.frames || a.seconds !== b.seconds || a.filter !== b.filter;
  });
}

/** What is saved for a draft; an emptied name falls back to the photo's current one. */
export function draftToMetadata(draft: PhotoMetadataDraft, currentName: string) {
  return {
    dsoIds: draft.dsoIds,
    labels: draft.labels,
    pointsOfInterest: draft.pointsOfInterest,
    integrations: sanitizeIntegrations(draft.integrations),
    observationDate: draft.observationDate || null,
    captureDetails: sanitizeCaptureDetails(draft.captureDetails),
    gearSetupId: draft.gearSetupId || null,
    notes: draft.notes,
    originalName: draft.displayName.trim() || currentName,
  };
}

/**
 * What a solved (WCS/FITS/TIFF) file adds to a draft: only what the draft does not have yet (the date, one integration
 * row when there is none, the capture fields that are absent or empty), never over a value the user entered.
 * `filled` counts the values added.
 */
export function fillDraftFromWcs(
  draft: PhotoMetadataDraft,
  result: PlateSolveResult,
): { patch: Partial<PhotoMetadataDraft>; filled: number } {
  const patch: Partial<PhotoMetadataDraft> = {};
  let filled = 0;
  if (result.dateObs && !draft.observationDate) {
    patch.observationDate = result.dateObs;
    filled++;
  }
  if (result.expTime && result.stackCnt && draft.integrations.length === 0) {
    patch.integrations = [
      {
        frames: Math.round(result.stackCnt),
        seconds: Math.round(result.expTime),
        filter: result.filter ?? '',
      },
    ];
    filled++;
  }
  if (result.captureDetails) {
    const merged: CaptureDetails = { ...draft.captureDetails };
    for (const [key, value] of Object.entries(result.captureDetails)) {
      if (merged[key] === undefined || merged[key] === '') {
        merged[key] = value;
        filled++;
      }
    }
    patch.captureDetails = merged;
  }
  return { patch, filled };
}

/**
 * Returns labels from `knownLabels` that:
 *   - are not already in `currentLabels` (excluded from suggestions)
 *   - contain `query` as a substring (case-insensitive); all pass when query is empty
 * Results are capped at `maxResults`.
 */
export function filterLabelCandidates(
  knownLabels: string[],
  currentLabels: string[],
  query: string,
  maxResults = 8,
): string[] {
  const excluded = new Set(currentLabels);
  const q = query.trim().toLowerCase();
  return knownLabels
    .filter((l) => !excluded.has(l) && (!q || l.toLowerCase().includes(q)))
    .slice(0, maxResults);
}
