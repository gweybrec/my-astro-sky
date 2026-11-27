import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Router } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import { ANY_PHOTO_EXT_RE } from '@myastrosky/core/photo-formats';
import { isPlacedPhoto } from '@myastrosky/core/photo-placement';
import { findPhotoWithFileName } from '@myastrosky/core/photo-name-match';
import { getPhotos } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { addImportFiles } from './composables/usePhotoImport';
import { chooseExistingOrNew } from './composables/useConfirm';
import { useErrorToast } from './composables/useErrorToast';
import { skyPhotoFocus } from './composables/useSkySelection';

// Photo files another app hands to MyAstroSky ("Ouvrir avec", "Partager") open "Importer des photos", as if picked with
// the gallery's plus button. One file named like one of the user's photos asks first (board "Ouvrir avec, nom déjà
// utilisé"): show that photo, or add the file as a new photo.

/** A file the Android side copied into the app's cache. */
interface CachedFile {
  path: string;
  name: string;
  mimeType: string;
}

/** The Android plugin of `MainActivity` (OpenedFilesPlugin.java). */
export interface OpenedFilesPlugin {
  take(): Promise<{ files: CachedFile[] }>;
  addListener(event: 'openedFiles', listener: () => void): Promise<PluginListenerHandle>;
}

export const OpenedFiles = registerPlugin<OpenedFilesPlugin>('OpenedFiles');

const IMPORT_PATH = '/gallery/import';

/** Reads a cached file through the WebView's address of it, as the file picker's files are read. */
async function readCached(file: CachedFile): Promise<File> {
  const blob = await (await fetch(Capacitor.convertFileSrc(file.path))).blob();
  return new File([blob], file.name, { type: file.mimeType });
}

async function openImport(router: Router): Promise<void> {
  if (router.currentRoute.value.path !== IMPORT_PATH) await router.push(IMPORT_PATH);
}

/** Opens "Importer des photos" with the files, or first asks about one file named like one of the user's photos. */
export async function handleOpenedFiles(files: File[], router: Router): Promise<void> {
  if (files.length === 0) return;
  const { showError } = useErrorToast();
  const valid = files.filter((f) => ANY_PHOTO_EXT_RE.test(f.name));
  if (valid.length === 0) {
    void showError(t('errors.invalidPhotoFormat'));
    return;
  }
  if (valid.length !== files.length) void showError(t('errors.someFilesSkipped'));

  if (valid.length === 1) {
    const existing = findPhotoWithFileName(valid[0].name, await getPhotos());
    if (existing) {
      const placed = isPlacedPhoto(existing);
      const choice = await chooseExistingOrNew(existing.originalName, placed);
      if (choice === 'cancel') return;
      if (choice === 'show') {
        if (placed) {
          skyPhotoFocus.value = existing.id;
          await router.replace('/tabs/sky');
        } else {
          await router.push(`/gallery/photo/${existing.id}`);
        }
        return;
      }
    }
  }
  addImportFiles(valid);
  await openImport(router);
}

/**
 * Takes the files opened before the page was up, then those opened while the app runs (Android only). Files arriving
 * while earlier ones are handled wait their turn.
 */
export async function startOpenWith(
  router: Router,
  plugin: OpenedFilesPlugin = OpenedFiles,
  read: (file: CachedFile) => Promise<File> = readCached,
): Promise<void> {
  let queue = Promise.resolve();
  const takeAll = () => {
    queue = queue
      .then(async () => {
        const { files } = await plugin.take();
        await handleOpenedFiles(await Promise.all(files.map(read)), router);
      })
      .catch((error: unknown) => {
        reportError('openWith', error);
      });
    return queue;
  };
  await plugin.addListener('openedFiles', () => void takeAll());
  await takeAll();
}
