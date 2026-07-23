import type { Photo, PhotoIntegration, PointOfInterest, CaptureDetails } from './types';

/** Which field the batch editor is editing. */
export type BatchEditMode = 'label' | 'setup';

/**
 * Sentinel for the setup sub-header select: "leave every photo's setup alone".
 * Distinct from '' which means an explicit "no setup" (clears the link).
 */
export const SETUP_NO_CHANGE = '__no_change__';

/** Per-row editable state, seeded from the photo and mutated by the row widgets. */
export interface PhotoEditDraft {
  labels: string[];
  gearSetupId: string | null;
}

/** The sub-header ("apply to checked photos") state. */
export interface BatchEditPending {
  labels: string[];
  setupId: string;
}

/** One photo that will actually be written, with its resolved values. */
export interface BatchEditResult {
  photo: Photo;
  labels: string[];
  gearSetupId: string | null;
}

/** Case-sensitive union preserving order: draft labels first, then new pending ones. */
function mergeLabels(draft: string[], pending: string[]): string[] {
  const out = [...draft];
  for (const label of pending) {
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function sameLabels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((label, i) => label === b[i]);
}

/** Draft seeded from a photo's current values. */
export function draftFromPhoto(photo: Photo): PhotoEditDraft {
  return { labels: [...photo.labels], gearSetupId: photo.gearSetupId ?? null };
}

/**
 * Resolve every photo's final value and keep only those that differ from what the
 * photo already holds.
 *
 * - `label` mode: the row draft, plus the sub-header labels merged in when the photo
 *   is checked (nothing is ever removed by the bulk apply).
 * - `setup` mode: the sub-header setup wins for checked photos (including '' to clear
 *   the link), unless it is `SETUP_NO_CHANGE`; otherwise the row draft stands.
 *
 * A photo with no draft entry is treated as unedited.
 */
export function collectBatchEdits(
  mode: BatchEditMode,
  photos: Photo[],
  drafts: Map<string, PhotoEditDraft>,
  checked: Set<string>,
  pending: BatchEditPending,
): BatchEditResult[] {
  const results: BatchEditResult[] = [];

  for (const photo of photos) {
    const draft = drafts.get(photo.id) ?? draftFromPhoto(photo);
    const isChecked = checked.has(photo.id);

    let labels = draft.labels;
    let gearSetupId = draft.gearSetupId;

    if (mode === 'label') {
      if (isChecked && pending.labels.length > 0)
        labels = mergeLabels(draft.labels, pending.labels);
    } else if (isChecked && pending.setupId !== SETUP_NO_CHANGE) {
      gearSetupId = pending.setupId || null;
    }

    const changed =
      mode === 'label'
        ? !sameLabels(labels, photo.labels)
        : gearSetupId !== (photo.gearSetupId ?? null);

    if (changed) results.push({ photo, labels, gearSetupId });
  }

  return results;
}

/**
 * Full metadata payload for `updatePhotoMetadata`. Every field is carried over from the
 * photo because `PATCH /api/photos/:id/metadata` **replaces** rather than merges — an
 * omitted `dsoIds`/`notes`/`integrations` would be wiped server-side.
 */
export function buildMetadataPayload(
  photo: Photo,
  overrides: { labels?: string[]; gearSetupId?: string | null } = {},
): {
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  observationDate: string | null;
  captureDetails: CaptureDetails | null;
  gearSetupId: string | null;
  notes: string;
  originalName: string;
} {
  return {
    dsoIds: [...photo.dsoIds],
    labels: overrides.labels ? [...overrides.labels] : [...photo.labels],
    pointsOfInterest: photo.pointsOfInterest ?? [],
    integrations: photo.integrations ?? [],
    observationDate: photo.observationDate ?? null,
    captureDetails: photo.captureDetails ?? null,
    gearSetupId:
      overrides.gearSetupId !== undefined ? overrides.gearSetupId : (photo.gearSetupId ?? null),
    notes: photo.notes,
    originalName: photo.originalName,
  };
}

/** Apply a resolved edit to a photo, producing the new in-memory Photo. */
export function applyBatchEdit(edit: BatchEditResult): Photo {
  return { ...edit.photo, labels: edit.labels, gearSetupId: edit.gearSetupId };
}
