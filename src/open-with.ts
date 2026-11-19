/**
 * "Open with MyAstroSky" on the desktop app: the photo files the system hands to the app open "Ajouter des photos",
 * as if picked with "+ Ajouter des photos". One file named like a photo already added asks first whether to show
 * that photo or add the file as a new one.
 */
import type { Photo } from '@myastrosky/core/types';
import { ANY_PHOTO_EXT_RE } from '@myastrosky/core/photo-formats';
import { isPlacedPhoto } from '@myastrosky/core/photo-placement';
import { findPhotoWithFileName } from '@myastrosky/core/photo-name-match';
import { getPhotos } from './api';
import { triggerBatchModal } from './ui';
import { chooseExistingOrNew } from './photo-delete-confirm';
import { showToast } from './toast';
import { t } from './i18n';
import { pinia } from './pinia-instance';
import { useUiStore } from './stores/ui';
import { usePhotosStore } from './stores/photos';
import { useCanvasStore } from './stores/canvas';

/** A file as the desktop app's main process sends it: its name and bytes. */
export interface OpenedFile {
  name: string;
  data: Uint8Array;
}

interface OpenWithBridge {
  takeOpenedFiles?: () => Promise<OpenedFile[]>;
  onOpenedFiles?: (callback: (files: OpenedFile[]) => void) => void;
}

/** The photo map view needs a moment to take its size back before it can be centred. */
const MAP_SHOWN_DELAY_MS = 80;

function showExistingPhoto(photo: Photo, placed: boolean): void {
  const ui = useUiStore(pinia);
  if (!placed) {
    ui.switchView('gallery');
    useCanvasStore(pinia).gallery?.openPhoto(photo.id);
    return;
  }
  ui.switchView('skymap');
  setTimeout(() => {
    const photos = usePhotosStore(pinia);
    photos.selectPhoto(photo.id);
    photos.zoomToPhoto(photo.id);
  }, MAP_SHOWN_DELAY_MS);
}

/** Opens "Ajouter des photos" with the files, or first asks about one file named like a photo already added. */
export async function handleOpenedFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  const valid = files.filter((f) => ANY_PHOTO_EXT_RE.test(f.name));
  if (valid.length === 0) {
    showToast({ message: t('errors.invalidPhotoFormat'), type: 'error', duration: 3500 });
    return;
  }
  if (valid.length !== files.length) {
    showToast({ message: t('errors.someFilesSkipped'), type: 'error', duration: 3500 });
  }

  if (valid.length === 1) {
    const existing = findPhotoWithFileName(valid[0].name, await getPhotos());
    if (existing) {
      const placed = isPlacedPhoto(existing);
      const choice = await chooseExistingOrNew(existing.originalName, placed);
      if (choice === 'show') showExistingPhoto(existing, placed);
      if (choice !== 'add') return;
    }
  }
  triggerBatchModal(valid);
}

/** The type a file picker gives (the server accepts pictures by type, raw astro files by name). */
const PICTURE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function toFiles(opened: readonly OpenedFile[]): File[] {
  return opened.map((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    return new File([f.data as Uint8Array<ArrayBuffer>], f.name, {
      type: PICTURE_TYPES[ext] ?? '',
    });
  });
}

/** Takes the files opened at launch, then listens for files opened while the app runs (desktop app only). */
export async function startOpenWith(bridge: OpenWithBridge | undefined): Promise<void> {
  if (!bridge?.takeOpenedFiles || !bridge.onOpenedFiles) return;
  bridge.onOpenedFiles((opened) => void handleOpenedFiles(toFiles(opened)));
  await handleOpenedFiles(toFiles(await bridge.takeOpenedFiles()));
}
