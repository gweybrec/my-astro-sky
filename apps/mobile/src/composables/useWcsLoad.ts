import { ref, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { PlateSolveResult } from '@myastrosky/core/types';
import { solveWCS } from '@myastrosky/app-state/api';
import { pickFile, WCS_FILE_TYPES } from '../platform-device';
import { useErrorToast } from './useErrorToast';

/**
 * A WCS file read from the photo's sheet, waiting for its editor: the editor fills its empty fields with it when it
 * opens on that photo, then clears it.
 */
export const pendingWcs = shallowRef<{ photoId: string; result: PlateSolveResult } | null>(null);

/**
 * "Charger un fichier WCS", as the desktop's metadata editor: picks a solved companion file and reads its header.
 * `read` answers null when the picker is cancelled or the file cannot be read (an error toast says so).
 */
export function useWcsLoad() {
  const loading = ref(false);
  const { showError } = useErrorToast();

  async function read(photo: {
    width?: number;
    height?: number;
  }): Promise<PlateSolveResult | null> {
    if (loading.value) return null;
    const file = await pickFile(WCS_FILE_TYPES);
    if (!file) return null;
    loading.value = true;
    try {
      const result = await solveWCS(file, photo.width || undefined, photo.height || undefined);
      if (!result.success) {
        await showError(new Error(t('gallery.loadFromWcsError')));
        return null;
      }
      return result;
    } catch (error) {
      await showError(error instanceof Error ? error : new Error(t('gallery.loadFromWcsError')));
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { loading, read };
}
