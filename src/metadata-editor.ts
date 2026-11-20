import { createApp, reactive, h } from 'vue';
import type { App } from 'vue';
import type {
  Photo,
  PhotoIntegration,
  PointOfInterest,
  CaptureDetails,
} from '@myastrosky/core/types';
import type { GearSetupData } from './api';
import {
  updatePhotoMetadata,
  getGearSetups,
  getPhotoFitsHeaders,
  setPhotoFitsHeaders,
} from './api';
import {
  applyWcsChanges,
  draftFromPhoto,
  draftToMetadata,
  isDraftDirty,
  wcsDraftChanges,
} from '@myastrosky/core/photo-metadata-draft';
import { wcsThrownErrorMessage } from '@myastrosky/core/wcs-load';
import { fitsHeadersMissingKey, type FitsCard } from '@myastrosky/core/fits-header';
import { photoSkyModel } from '@myastrosky/core/photo-placement';
import { showWcsConflicts } from './wcs-conflicts';
import { showFitsHeaders } from './wcs-dialogs';
import { noSolutionMessage, readWcsFileForPhoto } from './wcs-load-flow';
import { showToast } from './toast';
import { t } from './i18n';
import MetadataEditorPanel from './components/modals/MetadataEditorPanel.vue';
import MetadataSheet from './components/modals/MetadataSheet.vue';
import type { PhotoMetadataDraft } from '@myastrosky/core/photo-metadata-draft';
import { reportUnknownRendererError } from './error-reporter';
import fileTextSvg from './icons/file-text.svg?raw';
import uploadSvg from './icons/upload.svg?raw';
import { pinia } from './pinia-instance';
import { RAW_COMPANION_ACCEPT } from '@myastrosky/core/photo-formats';
import { isTopmostOverlay } from './popup-utils';

const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

function normalizeFilterKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Build the metadata editing form (DSO IDs, labels, integrations, notes, save/cancel) into
 * the given container element. Suitable for embedding inside any parent modal.
 *
 * @param container  The element to populate with form fields.
 * @param photo      The photo whose metadata is being edited.
 * @param onSaved    Called with the updated Photo after a successful save.
 * @param onClose    Called to close/dismiss the parent container.
 * @returns          A teardown function to unmount the Vue app when the modal is destroyed.
 */
export function buildMetadataEditorPanel(
  container: HTMLElement,
  photo: Photo,
  onSaved: (updated: Photo) => void,
  onClose: () => void,
  knownLabels?: string[],
  knownFilters?: string[],
  /** Fired on every (unsaved) POI edit — lets the gallery detail view pin a
   * just-identified supernova on the photo before the user saves. */
  onPoisChange?: (pois: PointOfInterest[]) => void,
  /**
   * `headersButton: false`: no "Headers" button (the stand-alone editor; the headers are read in the photo's panel).
   * `sheet`: the gallery's photo panel: the facts read as text, each changed in place and saved at once (no Save
   * button); the "Headers" and "Load a WCS" buttons come first in its `.wcs-load-row`.
   */
  options: { headersButton?: boolean; sheet?: boolean } = {},
): {
  teardown: () => void;
  isDirty: () => boolean;
  /** Saves these fields at once (the sheet panel); true once saved. */
  saveFields: (patch: Partial<PhotoMetadataDraft>) => Promise<boolean>;
} {
  const sheet = options.sheet === true;
  // The photo as last saved here (the sheet saves several times while it is open).
  let current = photo;
  const original = draftFromPhoto(photo);

  const state = reactive({ ...draftFromPhoto(photo), gearSetups: [] as GearSetupData[] });

  // Gear-setup list loads asynchronously; the reactive assignment re-renders the picker.
  void getGearSetups()
    .then((setups) => {
      state.gearSetups = setups;
    })
    .catch(() => {
      /* leave empty on failure — the picker just shows "none" */
    });

  // Sheet: lines being edited (their typing is not saved yet).
  let editingCount = 0;
  const isDirty = (): boolean =>
    sheet ? editingCount > 0 : isDraftDirty(state, original) || loadedCards !== null;

  // Sheet: each change is saved at once, one save after the other, from the draft as it stands then.
  let saving: Promise<unknown> = Promise.resolve();
  const saveFields = (patch: Partial<PhotoMetadataDraft>): Promise<boolean> => {
    const run = saving.then(async () => {
      try {
        const metadata = draftToMetadata({ ...state, ...patch }, current.originalName);
        await updatePhotoMetadata(current.id, metadata);
        Object.assign(state, patch);
        current = { ...current, ...metadata };
        if (patch.pointsOfInterest) onPoisChange?.(state.pointsOfInterest);
        onSaved(current);
        return true;
      } catch (err) {
        reportUnknownRendererError('photo_metadata_save', err, { photoId: current.id });
        showToast({
          message: err instanceof Error ? err.message : String(err),
          type: 'error',
          duration: 4000,
        });
        return false;
      }
    });
    saving = run;
    return run;
  };

  const knownFilterMap = new Map<string, string>();
  const rememberFilters = (candidates: string[]) => {
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const key = normalizeFilterKey(trimmed);
      if (!knownFilterMap.has(key)) knownFilterMap.set(key, trimmed);
    }
  };
  rememberFilters(DEFAULT_INTEGRATION_FILTERS);
  rememberFilters(knownFilters ?? []);
  rememberFilters(state.integrations.map((row) => row.filter));

  // Mount the shared MetadataEditorPanel Vue component for form fields
  const panelEl = document.createElement('div');
  container.appendChild(panelEl);

  let app: App | null = createApp({
    render: () =>
      sheet
        ? h(MetadataSheet, {
            draft: state,
            gearSetups: state.gearSetups,
            knownFilterMap,
            knownLabels: knownLabels ?? [],
            photo: current,
            save: saveFields,
            onEditing: (n: number) => {
              editingCount = n;
            },
          })
        : h(MetadataEditorPanel, {
            displayName: state.displayName,
            dsoIds: state.dsoIds,
            labels: state.labels,
            pointsOfInterest: state.pointsOfInterest,
            integrations: state.integrations,
            observationDate: state.observationDate,
            captureDetails: state.captureDetails,
            gearSetupId: state.gearSetupId,
            gearSetups: state.gearSetups,
            notes: state.notes,
            knownFilterMap,
            knownLabels: knownLabels ?? [],
            photo,
            'onUpdate:displayName': (v: string) => {
              state.displayName = v;
            },
            'onUpdate:dsoIds': (v: string[]) => {
              state.dsoIds = v;
            },
            'onUpdate:labels': (v: string[]) => {
              state.labels = v;
            },
            'onUpdate:pointsOfInterest': (v: PointOfInterest[]) => {
              state.pointsOfInterest = v;
              onPoisChange?.(v);
            },
            'onUpdate:integrations': (v: PhotoIntegration[]) => {
              state.integrations = v;
            },
            'onUpdate:observationDate': (v: string) => {
              state.observationDate = v;
            },
            'onUpdate:captureDetails': (v: CaptureDetails) => {
              state.captureDetails = v;
            },
            'onUpdate:gearSetupId': (v: string | null) => {
              state.gearSetupId = v;
            },
            'onUpdate:notes': (v: string) => {
              state.notes = v;
            },
          }),
  });
  // PoiEditor (inside MetadataEditorPanel) reads the POI-categories / ui Pinia stores,
  // so this imperatively-mounted app needs the shared pinia instance installed.
  app.use(pinia);
  app.mount(panelEl);

  // ── Load metadata from a WCS/FITS/TIFF file ───────────────────────────────────
  // Re-reads the photo's solved or raw file to back-fill capture metadata after the fact (e.g. when the photo was
  // placed with a different solver). A file without a plate solution still brings its capture data. The file is
  // checked against the photo first (size, objects, centre, OBJECT, gear: `readWcsFileForPhoto`), and the user goes
  // on past the warnings on purpose. Empty fields are filled; values that differ from ones already entered are
  // listed so the user picks which to replace. Nothing is saved before Save, the file's header cards included.
  const wcsRow = document.createElement('div');
  // `wcs-load-row` is a hook gallery.ts uses to relocate this out of the scrolling
  // form into the fixed action area; `my-2` spaces it in the standalone modal.
  wcsRow.className = 'wcs-load-row my-2 flex gap-2';

  const wcsBtn = document.createElement('button');
  wcsBtn.type = 'button';
  if (sheet) {
    // Second in importance, after the headers: a plain button with a short label.
    wcsBtn.className =
      'integration-add-btn !m-0 h-[32px] !py-0 !px-4 inline-flex items-center gap-2 font-[inherit] text-base [&>svg]:w-[14px] [&>svg]:h-[14px]';
    wcsBtn.innerHTML = uploadSvg;
    wcsBtn.append(t('gallery.sheet.loadWcs'));
    wcsBtn.title = t('gallery.loadFromWcs');
  } else {
    wcsBtn.className = 'btn-action flex-1';
    wcsBtn.textContent = t('gallery.loadFromWcs');
  }

  // The header cards of the file read in this editor, saved with the photo on Save.
  let loadedCards: FitsCard[] | null = null;
  // The headers are read-only: only the photo's own panel (the gallery) shows them, beside the WCS button. Without
  // any, the button stays, greyed out, and says why when pressed.
  const headersBtn = document.createElement('button');
  headersBtn.type = 'button';
  headersBtn.dataset.test = 'fits-headers-btn';
  if (sheet) {
    // The panel's main button: the widest, in the accent colour.
    headersBtn.className =
      'btn-action flex-1 min-w-0 h-[32px] !py-0 !px-5 inline-flex items-center justify-center gap-2 [&>svg]:w-[14px] [&>svg]:h-[14px]';
    headersBtn.innerHTML = fileTextSvg;
    headersBtn.append(t('modal.fitsHeadersButton'));
  } else {
    headersBtn.className = 'btn-action';
    headersBtn.textContent = t('modal.fitsHeadersButton');
  }
  headersBtn.title = t('modal.fitsHeadersTitle');
  const missingKey = () => (loadedCards ? null : fitsHeadersMissingKey(current));
  const showHeadersBtn = () => {
    if (missingKey()) headersBtn.setAttribute('aria-disabled', 'true');
    else headersBtn.removeAttribute('aria-disabled');
  };
  showHeadersBtn();
  headersBtn.addEventListener('click', () => {
    const missing = missingKey();
    if (missing) {
      showToast({ message: t(missing), type: 'info', duration: 5000 });
      return;
    }
    void showFitsHeaders(loadedCards ?? (() => getPhotoFitsHeaders(current.id)));
  });

  const wcsInput = document.createElement('input');
  wcsInput.type = 'file';
  wcsInput.accept = RAW_COMPANION_ACCEPT;
  wcsInput.className = 'hidden';

  wcsBtn.addEventListener('click', () => {
    wcsInput.value = '';
    wcsInput.click();
  });

  wcsInput.addEventListener('change', async () => {
    const file = wcsInput.files?.[0];
    if (!file) return;
    wcsBtn.disabled = true;
    const label = wcsBtn.innerHTML;
    wcsBtn.textContent = t('gallery.loadFromWcsLoading');
    try {
      const outcome = await readWcsFileForPhoto(file, {
        width: photo.width,
        height: photo.height,
        dsoIds: state.dsoIds,
        skyModel: photoSkyModel(photo),
        gearSetupId: state.gearSetupId,
      });
      if (outcome.kind === 'error') {
        showToast({ message: outcome.message, type: 'error', duration: 8000 });
        return;
      }
      if (outcome.kind === 'cancelled') return;
      const { result, solved, suggestedSetup } = outcome;

      const { fills, conflicts } = wcsDraftChanges(state, result, suggestedSetup);
      let taken = fills;
      if (conflicts.length > 0) {
        const chosen = await showWcsConflicts(conflicts);
        if (!chosen) return;
        taken = [...fills, ...chosen];
      }
      const patch = applyWcsChanges(state, taken);
      if (patch.integrations) rememberFilters(patch.integrations.map((row) => row.filter));
      if (sheet) {
        // The sheet saves at once: the values taken, then the file's header cards.
        if (Object.keys(patch).length > 0 && !(await saveFields(patch))) return;
        if (result.fitsHeaders?.length) {
          await setPhotoFitsHeaders(current.id, result.fitsHeaders);
          current = { ...current, hasFitsHeaders: true };
          onSaved(current);
          showHeadersBtn();
        }
      } else {
        Object.assign(state, patch);
        if (result.fitsHeaders?.length) {
          loadedCards = result.fitsHeaders;
          showHeadersBtn();
        }
      }
      showToast({
        message: !solved
          ? noSolutionMessage(file.name)
          : taken.length > 0
            ? t('gallery.loadFromWcsSuccess')
            : t('gallery.loadFromWcsEmpty'),
        type: solved ? 'info' : 'warning',
        duration: solved ? 3500 : 8000,
      });
    } catch (err) {
      showToast({
        message: wcsThrownErrorMessage(err, file.name),
        type: 'error',
        duration: 8000,
      });
    } finally {
      wcsBtn.disabled = false;
      wcsBtn.innerHTML = label;
    }
  });

  if (sheet) {
    // By importance: the headers first, then the WCS file (the gallery adds "⋯" after them).
    wcsRow.appendChild(headersBtn);
    wcsRow.appendChild(wcsBtn);
  } else {
    wcsRow.appendChild(wcsBtn);
    if (options.headersButton !== false) wcsRow.appendChild(headersBtn);
  }
  wcsRow.appendChild(wcsInput);
  // Placed after the form (panelEl) and before the save/delete row, full width.
  container.appendChild(wcsRow);

  const teardown = () => {
    if (app) {
      app.unmount();
      app = null;
    }
  };
  if (sheet) return { teardown, isDirty, saveFields };

  // ── Buttons (imperative DOM so gallery.ts can query and move them) ────────────
  const btnRow = document.createElement('div');
  btnRow.className = 'meta-editor-btns';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = t('gallery.cancelEdit');
  cancelBtn.addEventListener('click', onClose);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-confirm';
  saveBtn.textContent = t('gallery.saveMetadata');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '…';
    try {
      const metadata = draftToMetadata(state, current.originalName);
      await updatePhotoMetadata(current.id, metadata);
      if (loadedCards) await setPhotoFitsHeaders(current.id, loadedCards);
      const updated: Photo = {
        ...current,
        ...metadata,
        ...(loadedCards ? { hasFitsHeaders: true } : {}),
      };
      onClose();
      onSaved(updated);
    } catch (err: any) {
      showToast({ message: err.message, type: 'error', duration: 4000 });
      saveBtn.disabled = false;
      saveBtn.textContent = t('gallery.saveMetadata');
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  container.appendChild(btnRow);

  return { teardown, isDirty, saveFields };
}

/**
 * Open a standalone modal to edit dsoIds, labels and notes for a photo.
 * Calls onSaved with the updated Photo object after a successful PATCH.
 */
export function showMetadataEditor(
  photo: Photo,
  onSaved: (updated: Photo) => void,
  knownLabels?: string[],
  knownFilters?: string[],
): void {
  // ── Overlay ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'meta-editor-overlay';

  const modal = document.createElement('div');
  modal.className = 'meta-editor-modal';
  modal.addEventListener('click', (e) => e.stopPropagation());

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Trap Escape key
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isTopmostOverlay(overlay)) close();
  };
  document.addEventListener('keydown', onKey);

  let teardown: (() => void) | null = null;

  function close() {
    document.removeEventListener('keydown', onKey);
    teardown?.();
    overlay.remove();
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = document.createElement('h3');
  title.className = 'meta-editor-title';
  title.textContent = t('gallery.metadataTitle');
  modal.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'meta-editor-subtitle';
  subtitle.textContent = photo.originalName;
  modal.appendChild(subtitle);

  const panel = buildMetadataEditorPanel(
    modal,
    photo,
    onSaved,
    close,
    knownLabels,
    knownFilters,
    undefined,
    { headersButton: false },
  );
  teardown = panel.teardown;

  // Focus DSO input
  requestAnimationFrame(() => modal.querySelector<HTMLInputElement>('.tag-input')?.focus());
}
