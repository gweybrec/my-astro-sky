import type {
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
  CaptureDetails,
} from './types';
import type { BatchItem } from './batch-types';
import { sanitizeIntegrationRows } from './batch-utils';
import { sanitizeCaptureDetails } from './capture-fields';

type UploadFn = (
  file: File,
  correspondences: PhotoCorrespondence[],
  manualPlacement?: undefined,
  onProgress?: undefined,
  metadata?: {
    dsoIds?: string[];
    labels?: string[];
    pointsOfInterest?: PointOfInterest[];
    integrations?: PhotoIntegration[];
    notes?: string;
    displayName?: string;
    observationDate?: string | null;
    captureDetails?: CaptureDetails | null;
    gearSetupId?: string | null;
  },
) => Promise<Photo>;

export async function placeBatchItem(
  item: BatchItem,
  batchLabels: string[],
  uploadFn: UploadFn,
  onPlaced: (photo: Photo) => void,
  tFn: (key: string) => string,
): Promise<void> {
  item.status = 'placing';
  delete item.uploadError;
  try {
    const photo = await uploadFn(item.file, item.solveCorrespondences!, undefined, undefined, {
      dsoIds: item.dsoIds,
      labels: [...new Set([...item.labels, ...batchLabels])],
      pointsOfInterest: item.pointsOfInterest,
      integrations: sanitizeIntegrationRows(item.integrations),
      observationDate: item.observationDate || null,
      captureDetails: sanitizeCaptureDetails(item.captureDetails),
      gearSetupId: item.gearSetupId || null,
      notes: item.notes,
      displayName: item.customName,
    });
    item.photo = photo;
    item.status = 'placed';
    onPlaced(photo);
  } catch (err: any) {
    item.uploadError = err.message || tFn('batch.statusFailed');
    item.status = 'success';
  }
}
