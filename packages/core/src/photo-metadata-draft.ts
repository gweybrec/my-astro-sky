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

/** A value a solved (WCS/FITS/TIFF) file brings for one field of the draft. */
export type WcsChange =
  | { key: 'observationDate'; current: string; incoming: string }
  | { key: 'integrations'; current: PhotoIntegration[]; incoming: PhotoIntegration[] }
  | {
      key: `capture.${string}`;
      field: string;
      current: string | number | undefined;
      incoming: string | number;
    };

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

function sameDate(a: string, b: string): boolean {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb;
}

function sameIntegrations(a: PhotoIntegration[], b: PhotoIntegration[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, i) =>
        row.frames === b[i].frames &&
        row.seconds === b[i].seconds &&
        row.filter.trim() === b[i].filter.trim(),
    )
  );
}

/**
 * What a solved (WCS/FITS/TIFF) file brings to a draft: `fills` are values for fields the draft does not have yet
 * (the date, one integration row when there is none, the capture fields that are absent or empty); `conflicts` are
 * values that differ from one the draft already has, which the user chooses to take or not. Equal values are left out.
 */
export function wcsDraftChanges(
  draft: PhotoMetadataDraft,
  result: PlateSolveResult,
): { fills: WcsChange[]; conflicts: WcsChange[] } {
  const fills: WcsChange[] = [];
  const conflicts: WcsChange[] = [];
  if (result.dateObs) {
    const change: WcsChange = {
      key: 'observationDate',
      current: draft.observationDate,
      incoming: result.dateObs,
    };
    if (!draft.observationDate) fills.push(change);
    else if (!sameDate(draft.observationDate, result.dateObs)) conflicts.push(change);
  }
  if (result.expTime && result.stackCnt) {
    const incoming = [
      {
        frames: Math.round(result.stackCnt),
        seconds: Math.round(result.expTime),
        filter: result.filter ?? '',
      },
    ];
    const current = sanitizeIntegrations(draft.integrations);
    const change: WcsChange = { key: 'integrations', current, incoming };
    if (draft.integrations.length === 0) fills.push(change);
    else if (!sameIntegrations(current, incoming)) conflicts.push(change);
  }
  for (const [field, incoming] of Object.entries(result.captureDetails ?? {})) {
    if (isEmpty(incoming)) continue;
    const current = draft.captureDetails[field];
    const change: WcsChange = { key: `capture.${field}`, field, current, incoming };
    if (isEmpty(current)) fills.push(change);
    else if (String(current).trim() !== String(incoming).trim()) conflicts.push(change);
  }
  return { fills, conflicts };
}

/** The draft fields to assign so that it holds the incoming value of each change. */
export function applyWcsChanges(
  draft: PhotoMetadataDraft,
  changes: WcsChange[],
): Partial<PhotoMetadataDraft> {
  const patch: Partial<PhotoMetadataDraft> = {};
  for (const change of changes) {
    if (change.key === 'observationDate') patch.observationDate = change.incoming;
    else if (change.key === 'integrations')
      patch.integrations = change.incoming.map((row) => ({ ...row }));
    else {
      patch.captureDetails ??= { ...draft.captureDetails };
      patch.captureDetails[change.field] = change.incoming;
    }
  }
  return patch;
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
