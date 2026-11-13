import { computed, ref } from 'vue';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { sharedSkyLacksRoom, sharedSkyPreviewKeys } from '@myastrosky/core/shared-sky-view';
import type { SharedSkyPreview } from '@myastrosky/core/domain/shared-sky';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { SHARED_SKY_FILE_TYPES, pickFile } from '../platform-device';
import { useConfirm } from './useConfirm';
import { useErrorToast } from './useErrorToast';

/** Where an opening stands: nothing, the file being read, the confirmation shown, the photos being kept. */
export type SharedSkyOpenStep = 'idle' | 'reading' | 'confirm' | 'importing';

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

const dateText = (iso: string) => new Date(iso).toLocaleDateString(getLang());

/** The lines of the confirmation (boards "Ouvrir un ciel partagé" and "…, mise à jour"), as the desktop writes them. */
export function sharedSkyPreviewLines(preview: SharedSkyPreview): string[] {
  const keys = sharedSkyPreviewKeys(preview.status);
  const lines = [
    t(keys.message, {
      name: preview.senderName,
      date: dateText(preview.sharedAt),
      kept: preview.existing ? dateText(preview.existing.sharedAt) : '',
      count: String(preview.photoCount),
      size: formatBytes(preview.bytes),
    }),
  ];
  if (preview.status !== 'new') {
    lines.push(
      t('sharedSky.previewContent', {
        count: String(preview.photoCount),
        size: formatBytes(preview.bytes),
      }),
    );
  }
  if (preview.freeBytes !== null) {
    lines.push(t('sharedSky.freeSpace', { size: formatBytes(preview.freeBytes) }));
  }
  return lines;
}

/**
 * "Ouvrir un ciel partagé…": picks a file, reads it, asks for confirmation, then keeps it as a visit, with its
 * progress and a cancel (board "Ouvrir un ciel partagé, import en cours"). The desktop's shared skies window does the
 * same steps.
 */
export function useSharedSkyOpen() {
  const store = useSharedSkiesStore();
  const { confirm } = useConfirm();
  const { showError, showNotice } = useErrorToast();

  const step = ref<SharedSkyOpenStep>('idle');
  const progress = ref(0);
  let abort: AbortController | null = null;
  let ticket: string | null = null;

  const busy = computed(() => step.value !== 'idle');
  /** The progress line, while a file is read or kept. */
  const progressText = computed(() =>
    step.value === 'reading' || step.value === 'importing'
      ? t(step.value === 'reading' ? 'sharedSky.reading' : 'sharedSky.importing', {
          pct: String(Math.round(progress.value * 100)),
        })
      : '',
  );

  function reset() {
    step.value = 'idle';
    progress.value = 0;
    abort = null;
    ticket = null;
  }

  function fail(category: string, err: unknown) {
    if (isAbort(err)) return;
    reportError(category, err);
    void showError(err instanceof Error ? err : new Error(t('errors.openSharedSky')));
  }

  function discard(pending: string) {
    store.discard(pending).catch((err) => reportError('shared_sky_discard', err));
  }

  /** Reads a file (picked here, or handed by another app), asks, then keeps it. */
  async function openFile(file: File): Promise<void> {
    if (busy.value) return;
    step.value = 'reading';
    progress.value = 0;
    abort = new AbortController();
    let preview: SharedSkyPreview;
    try {
      const inspected = await store.inspect(file, {
        cancel: abort.signal,
        onProgress: (fraction) => (progress.value = fraction),
      });
      ticket = inspected.ticket;
      preview = inspected.preview;
    } catch (err) {
      fail('shared_sky_inspect', err);
      reset();
      return;
    }
    const pending = ticket;
    step.value = 'confirm';
    if (sharedSkyLacksRoom(preview)) {
      void showError(new Error(t('serverErrors.NOT_ENOUGH_SPACE')));
      discard(pending);
      reset();
      return;
    }
    const yes = await confirm({
      title: t('mobile.sharedSky.openTitle'),
      message: sharedSkyPreviewLines(preview).join('\n'),
      confirmLabel: t(sharedSkyPreviewKeys(preview.status).confirm),
    });
    if (!yes) {
      discard(pending);
      reset();
      return;
    }
    step.value = 'importing';
    progress.value = 0;
    abort = new AbortController();
    try {
      const sky = await store.open(pending, {
        cancel: abort.signal,
        onProgress: (fraction) => (progress.value = fraction),
      });
      void showNotice(t('sharedSky.opened', { name: sky.senderName }));
    } catch (err) {
      fail('shared_sky_open', err);
    }
    reset();
  }

  /** Opens the phone's file picker, then reads the file chosen. */
  async function chooseFile(): Promise<void> {
    if (busy.value) return;
    let file: File | null;
    try {
      file = await pickFile(SHARED_SKY_FILE_TYPES);
    } catch (err) {
      fail('shared_sky_pick', err);
      return;
    }
    if (file) await openFile(file);
  }

  /** Stops the file being read or kept; nothing of it is kept. */
  function cancel() {
    abort?.abort();
    if (step.value === 'reading') reset();
  }

  return { step, progress, progressText, busy, chooseFile, openFile, cancel };
}
