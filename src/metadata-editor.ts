import { createApp, reactive, h } from 'vue';
import type { App } from 'vue';
import type { Photo, PhotoIntegration, PointOfInterest, CaptureDetails } from './types';
import type { GearSetupData } from './api';
import { updatePhotoMetadata, getGearSetups, solveWCS } from './api';
import { sanitizeCaptureDetails } from './capture-fields';
import { showToast } from './toast';
import { t } from './i18n';
import MetadataEditorPanel from './components/modals/MetadataEditorPanel.vue';
import { pinia } from './pinia-instance';

const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

function normalizeFilterKey(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeIntegrations(rows: PhotoIntegration[]): PhotoIntegration[] {
  return rows.map((row) => ({
    frames:
      Number.isInteger(Number(row.frames)) && Number(row.frames) >= 0 ? Number(row.frames) : 0,
    seconds:
      Number.isInteger(Number(row.seconds)) && Number(row.seconds) >= 0 ? Number(row.seconds) : 0,
    filter: row.filter.trim(),
  }));
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
): { teardown: () => void; isDirty: () => boolean } {
  const original = {
    displayName: photo.originalName,
    dsoIds: [...photo.dsoIds],
    labels: [...photo.labels],
    pointsOfInterest: (photo.pointsOfInterest ?? []).map((p) => ({ ...p })),
    integrations: sanitizeIntegrations(photo.integrations ?? []),
    observationDate: photo.observationDate ?? '',
    captureDetails: sanitizeCaptureDetails(photo.captureDetails ?? {}),
    gearSetupId: photo.gearSetupId ?? null,
    notes: photo.notes ?? '',
  };

  const state = reactive({
    displayName: original.displayName,
    dsoIds: [...original.dsoIds],
    labels: [...original.labels],
    pointsOfInterest: original.pointsOfInterest.map((p) => ({ ...p })),
    integrations: original.integrations.map((r) => ({ ...r })),
    observationDate: original.observationDate,
    captureDetails: { ...original.captureDetails } as CaptureDetails,
    gearSetupId: original.gearSetupId,
    notes: original.notes,
    gearSetups: [] as GearSetupData[],
  });

  // Gear-setup list loads asynchronously; the reactive assignment re-renders the picker.
  void getGearSetups()
    .then((setups) => {
      state.gearSetups = setups;
    })
    .catch(() => {
      /* leave empty on failure — the picker just shows "none" */
    });

  function isDirty(): boolean {
    if (state.displayName !== original.displayName) return true;
    if (state.observationDate !== original.observationDate) return true;
    if (state.gearSetupId !== original.gearSetupId) return true;
    if (
      JSON.stringify(sanitizeCaptureDetails(state.captureDetails)) !==
      JSON.stringify(original.captureDetails)
    )
      return true;
    if (state.notes !== original.notes) return true;
    if (
      state.dsoIds.length !== original.dsoIds.length ||
      state.dsoIds.some((v, i) => v !== original.dsoIds[i])
    )
      return true;
    if (
      state.labels.length !== original.labels.length ||
      state.labels.some((v, i) => v !== original.labels[i])
    )
      return true;
    if (
      state.pointsOfInterest.length !== original.pointsOfInterest.length ||
      state.pointsOfInterest.some(
        (v, i) =>
          v.name !== original.pointsOfInterest[i].name ||
          v.categoryId !== original.pointsOfInterest[i].categoryId,
      )
    )
      return true;
    if (state.integrations.length !== original.integrations.length) return true;
    for (let i = 0; i < state.integrations.length; i++) {
      const a = state.integrations[i],
        b = original.integrations[i];
      if (a.frames !== b.frames || a.seconds !== b.seconds || a.filter !== b.filter) return true;
    }
    return false;
  }

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
      h(MetadataEditorPanel, {
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
  // Re-solves the companion file to back-fill capture metadata after the fact (e.g.
  // when the photo was placed with a different solver). Only fills empty fields —
  // never clobbers values the user already entered.
  const wcsRow = document.createElement('div');
  // `wcs-load-row` is a hook gallery.ts uses to relocate this out of the scrolling
  // form into the fixed action area; `my-2` spaces it in the standalone modal.
  wcsRow.className = 'wcs-load-row my-2';

  const wcsBtn = document.createElement('button');
  wcsBtn.type = 'button';
  wcsBtn.className = 'btn-action btn-action--full';
  wcsBtn.textContent = t('gallery.loadFromWcs');

  const wcsInput = document.createElement('input');
  wcsInput.type = 'file';
  wcsInput.accept = '.fit,.fits,.tif,.tiff';
  wcsInput.className = 'hidden';

  wcsBtn.addEventListener('click', () => {
    wcsInput.value = '';
    wcsInput.click();
  });

  wcsInput.addEventListener('change', async () => {
    const file = wcsInput.files?.[0];
    if (!file) return;
    wcsBtn.disabled = true;
    const label = wcsBtn.textContent;
    wcsBtn.textContent = t('gallery.loadFromWcsLoading');
    try {
      const result = await solveWCS(file, photo.width || undefined, photo.height || undefined);
      if (!result.success) {
        showToast({ message: t('gallery.loadFromWcsError'), type: 'error', duration: 4000 });
        return;
      }
      let filled = 0;
      if (result.dateObs && !state.observationDate) {
        state.observationDate = result.dateObs;
        filled++;
      }
      if (result.expTime && result.stackCnt && state.integrations.length === 0) {
        state.integrations = [
          {
            frames: Math.round(result.stackCnt),
            seconds: Math.round(result.expTime),
            filter: result.filter ?? '',
          },
        ];
        rememberFilters([result.filter ?? '']);
        filled++;
      }
      if (result.captureDetails) {
        const merged: CaptureDetails = { ...state.captureDetails };
        for (const [k, v] of Object.entries(result.captureDetails)) {
          if (merged[k] === undefined || merged[k] === '') {
            merged[k] = v;
            filled++;
          }
        }
        state.captureDetails = merged;
      }
      showToast({
        message: filled > 0 ? t('gallery.loadFromWcsSuccess') : t('gallery.loadFromWcsEmpty'),
        type: 'info',
        duration: 3500,
      });
    } catch (err: any) {
      showToast({
        message: err?.message || t('gallery.loadFromWcsError'),
        type: 'error',
        duration: 4000,
      });
    } finally {
      wcsBtn.disabled = false;
      wcsBtn.textContent = label;
    }
  });

  wcsRow.appendChild(wcsBtn);
  wcsRow.appendChild(wcsInput);
  // Placed after the form (panelEl) and before the save/delete row, full width.
  container.appendChild(wcsRow);

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
      const resolvedName = state.displayName.trim() || photo.originalName;
      const sanitizedIntegrations = sanitizeIntegrations(state.integrations);
      const resolvedObsDate = state.observationDate || null;
      const resolvedCapture = sanitizeCaptureDetails(state.captureDetails);
      const resolvedSetupId = state.gearSetupId || null;
      await updatePhotoMetadata(photo.id, {
        dsoIds: state.dsoIds,
        labels: state.labels,
        pointsOfInterest: state.pointsOfInterest,
        integrations: sanitizedIntegrations,
        observationDate: resolvedObsDate,
        captureDetails: resolvedCapture,
        gearSetupId: resolvedSetupId,
        notes: state.notes,
        originalName: resolvedName,
      });
      const updated: Photo = {
        ...photo,
        dsoIds: state.dsoIds,
        labels: state.labels,
        pointsOfInterest: state.pointsOfInterest,
        integrations: sanitizedIntegrations,
        observationDate: resolvedObsDate,
        captureDetails: resolvedCapture,
        gearSetupId: resolvedSetupId,
        notes: state.notes,
        originalName: resolvedName,
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

  return {
    teardown: () => {
      if (app) {
        app.unmount();
        app = null;
      }
    },
    isDirty,
  };
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
    if (e.key === 'Escape') close();
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

  const panel = buildMetadataEditorPanel(modal, photo, onSaved, close, knownLabels, knownFilters);
  teardown = panel.teardown;

  // Focus DSO input
  requestAnimationFrame(() => modal.querySelector<HTMLInputElement>('.tag-input')?.focus());
}
