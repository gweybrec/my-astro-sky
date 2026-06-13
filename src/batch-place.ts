import type { Photo, PhotoCorrespondence, PhotoIntegration } from './types';
import type { BatchItem } from './batch-types';
import { sanitizeIntegrationRows } from './batch-utils';

type UploadFn = (
  file: File,
  correspondences: PhotoCorrespondence[],
  manualPlacement?: undefined,
  onProgress?: undefined,
  metadata?: {
    dsoIds?: string[];
    labels?: string[];
    integrations?: PhotoIntegration[];
    notes?: string;
    displayName?: string;
    observationDate?: string | null;
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
      integrations: sanitizeIntegrationRows(item.integrations),
      observationDate: item.observationDate || null,
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
