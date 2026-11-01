import { pinia } from './pinia-instance';
import { t } from './i18n';
import { showToast } from './toast';
import { useFovFramesStore, type AdhocFrame } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';

/**
 * Which single frame to delete. Mosaics are NOT handled here — they keep their
 * own confirmation dialog at the call site.
 */
export type FrameDeleteTarget =
  | { kind: 'adhoc'; id: string; name: string }
  | { kind: 'plan'; planId: string; entryId: string; name: string };

interface DeleteFrameOptions {
  /** Run right after the frame is removed (e.g. drop the row / update counts). */
  onRemoved?: () => void;
  /** Run after an undo restores the frame (e.g. re-render the list). */
  onRestored?: () => void;
}

/**
 * Delete a single frame immediately and show an undo toast that re-creates it.
 * Shared by the sky-map FOV popup and the plan-details list so both behave
 * identically. Whole-plan deletes (and mosaic deletes) are handled separately.
 */
export function deleteFrameWithUndo(
  target: FrameDeleteTarget,
  opts: DeleteFrameOptions = {},
): void {
  const fovStore = useFovFramesStore(pinia);
  const plansStore = usePlansStore(pinia);

  let restore: () => Promise<void> | void;

  if (target.kind === 'adhoc') {
    // Snapshot the frame so undo can re-insert the exact same instance.
    const snapshot = fovStore.adhoc.find((f) => f.id === target.id);
    const frame: AdhocFrame | undefined = snapshot ? { ...snapshot } : undefined;
    fovStore.removeFrame(target.id);
    restore = () => {
      if (frame) fovStore.restoreAdhocFrame(frame);
    };
  } else {
    // Snapshot the entry before removal; undo re-creates it (a new id is assigned,
    // which is fine — the frame reappears with the same target, framing, windows
    // and place in the list).
    const plan = plansStore.plans.find((p) => p.id === target.planId);
    const index = plan?.entries.findIndex((e) => e.id === target.entryId) ?? -1;
    const entry = index >= 0 ? plan?.entries[index] : undefined;
    const snap = entry
      ? {
          dsoId: entry.dsoId,
          ra: entry.ra,
          dec: entry.dec,
          paDeg: entry.paDeg,
          mosaicWDeg: entry.mosaicWDeg ?? null,
          mosaicHDeg: entry.mosaicHDeg ?? null,
          observationWindows: (entry.observationWindows ?? []).map((w) => ({ ...w })),
          // The entry that followed it: the restored entry goes back before it.
          nextId: plan?.entries[index + 1]?.id ?? null,
        }
      : null;
    // Route through the store so floating/active state is cleared too (same as the
    // FOV popup's own delete path).
    void fovStore.deletePlanFrame(`plan:${target.planId}:${target.entryId}`);
    restore = async () => {
      if (!snap) return;
      let newId: string | null = null;
      if (snap.dsoId) {
        await plansStore.addEntry(target.planId, snap.dsoId);
        const p = plansStore.plans.find((pl) => pl.id === target.planId);
        // The re-added DSO entry is the last matching one.
        newId = [...(p?.entries ?? [])].reverse().find((e) => e.dsoId === snap.dsoId)?.id ?? null;
      } else if (snap.ra != null && snap.dec != null) {
        newId = await plansStore.addCustomEntry(target.planId, snap.ra, snap.dec);
      }
      if (newId) {
        plansStore.setEntryPosition(target.planId, newId, {
          ra: snap.ra,
          dec: snap.dec,
          paDeg: snap.paDeg,
          mosaicWDeg: snap.mosaicWDeg,
          mosaicHDeg: snap.mosaicHDeg,
        });
        if (snap.observationWindows.length > 0) {
          plansStore.setEntryObservationWindows(target.planId, newId, snap.observationWindows);
        }
        // Re-adding appends to the end of the list: move it back to its old place.
        const ids = (plansStore.plans.find((pl) => pl.id === target.planId)?.entries ?? [])
          .map((e) => e.id)
          .filter((id) => id !== newId);
        const at = snap.nextId ? ids.indexOf(snap.nextId) : -1;
        if (at >= 0) {
          ids.splice(at, 0, newId);
          await plansStore.reorderEntries(target.planId, ids);
        }
      }
    };
  }

  opts.onRemoved?.();

  showToast({
    message: t('fovOverlay.frameDeleted', { name: target.name }),
    type: 'undo',
    duration: 5000,
    actionLabel: t('fovOverlay.undo'),
    onAction: () => {
      void (async () => {
        await restore();
        opts.onRestored?.();
      })();
    },
  });
}
