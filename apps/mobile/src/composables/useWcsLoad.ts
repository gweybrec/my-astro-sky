import { ref, shallowRef } from 'vue';
import type { Photo, PlateSolveResult } from '@myastrosky/core/types';
import { photoSkyModel } from '@myastrosky/core/photo-placement';
import { wcsThrownErrorMessage } from '@myastrosky/core/wcs-load';
import { readWcsFileForPhoto } from '@myastrosky/app-state/wcs-load-flow';
import { pickFile, WCS_FILE_TYPES } from '../platform-device';
import { confirmWcsWarnings } from './useConfirm';
import { LONG_TOAST_MS, useErrorToast } from './useErrorToast';

/** A solved or raw file read for a photo, after the user went on past its warnings. */
export interface WcsLoaded {
  result: PlateSolveResult;
  /** False: the file has no plate solution, only its capture data and header cards were taken. */
  solved: boolean;
  /** The saved setup the header points to, for a photo without one. */
  suggestedSetup: { id: string; name: string } | null;
  filename: string;
}

/**
 * A file read from the photo's sheet, waiting for its editor: the editor takes its values when it opens on that photo,
 * then clears it.
 */
export const pendingWcs = shallowRef<({ photoId: string } & WcsLoaded) | null>(null);

/**
 * "Charger un fichier WCS", as the desktop's metadata editor: picks a solved or raw file, reads its header and checks
 * that it is probably the photo's file (`readWcsFileForPhoto`), asking once when something does not match. A file
 * without a plate solution still gives its capture data and header cards. `read` answers null when the picker or the
 * question is cancelled, or the file cannot be read (an error toast says why; `toasts.above` as `useErrorToast`). `current` gives the editor's unsaved
 * objects and setup, compared instead of the stored ones.
 */
export function useWcsLoad(toasts: { above?: string } = {}) {
  const loading = ref(false);
  const { showError } = useErrorToast(toasts);

  async function read(
    photo: Pick<
      Photo,
      'width' | 'height' | 'dsoIds' | 'correspondences' | 'manualPlacement' | 'gearSetupId'
    >,
    current?: { dsoIds: readonly string[]; gearSetupId: string | null },
  ): Promise<WcsLoaded | null> {
    if (loading.value) return null;
    const file = await pickFile(WCS_FILE_TYPES);
    if (!file) return null;
    loading.value = true;
    try {
      const outcome = await readWcsFileForPhoto(
        file,
        {
          width: photo.width,
          height: photo.height,
          dsoIds: current?.dsoIds ?? photo.dsoIds ?? [],
          skyModel: photoSkyModel(photo),
          gearSetupId: current ? current.gearSetupId : (photo.gearSetupId ?? null),
        },
        confirmWcsWarnings,
      );
      if (outcome.kind === 'error') {
        await showError(outcome.message, LONG_TOAST_MS);
        return null;
      }
      if (outcome.kind === 'cancelled') return null;
      return {
        result: outcome.result,
        solved: outcome.solved,
        suggestedSetup: outcome.suggestedSetup,
        filename: file.name,
      };
    } catch (error) {
      await showError(wcsThrownErrorMessage(error, file.name), LONG_TOAST_MS);
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { loading, read };
}
