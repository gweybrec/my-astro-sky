import { ref, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { PlateSolveResult } from '@myastrosky/core/types';
import { wcsErrorMessage, wcsThrownErrorMessage } from '@myastrosky/core/wcs-load';
import { solveWCS } from '@myastrosky/app-state/api';
import { pickFile, WCS_FILE_TYPES } from '../platform-device';
import { useConfirm } from './useConfirm';
import { useErrorToast } from './useErrorToast';

/** Long enough to read the explanation of a file that was not plate-solved. */
const ERROR_DURATION_MS = 8000;

/**
 * A WCS file read from the photo's sheet, waiting for its editor: the editor takes its values when it opens on that
 * photo (asking about the ones that differ from the photo's), then clears it.
 */
export const pendingWcs = shallowRef<{ photoId: string; result: PlateSolveResult } | null>(null);

/**
 * "Charger un fichier WCS", as the desktop's metadata editor: picks a solved companion file and reads its header. A
 * file whose proportions differ from the photo's (probably another photo's) asks first, as when adding a photo.
 * `read` answers null when the picker or that question is cancelled, or the file cannot be read (an error toast says
 * why).
 */
export function useWcsLoad() {
  const loading = ref(false);
  const { showError } = useErrorToast();
  const { confirm } = useConfirm();

  async function read(photo: {
    width?: number;
    height?: number;
  }): Promise<PlateSolveResult | null> {
    if (loading.value) return null;
    const file = await pickFile(WCS_FILE_TYPES);
    if (!file) return null;
    loading.value = true;
    let result: PlateSolveResult;
    try {
      result = await solveWCS(file, photo.width || undefined, photo.height || undefined);
    } catch (error) {
      await showError(wcsThrownErrorMessage(error, file.name), ERROR_DURATION_MS);
      return null;
    } finally {
      loading.value = false;
    }
    if (!result.success) {
      const info = wcsErrorMessage(result, file.name);
      await showError(t(info.key, info.params), ERROR_DURATION_MS);
      return null;
    }
    const warning = result.dimensionWarning;
    if (warning?.aspectMismatch) {
      const proceed = await confirm({
        title: t('modal.wcsDimensionMismatchTitle'),
        message: t('modal.wcsDimensionMismatchBody', {
          fitsW: String(warning.sourceW),
          fitsH: String(warning.sourceH),
          jpegW: String(warning.targetW),
          jpegH: String(warning.targetH),
        }),
        confirmLabel: t('modal.wcsContinueAnyway'),
      });
      if (!proceed) return null;
    }
    return result;
  }

  return { loading, read };
}
