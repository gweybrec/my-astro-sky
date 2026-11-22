import { computed, ref, watch, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import {
  fracToClock,
  framesInWindow,
  newObservationWindow,
} from '@myastrosky/core/observation-windows';
import { filterLabel, getFilters } from '@myastrosky/core/gear-catalog';
import type { ObservationWindow } from '@myastrosky/app-state/api';
import { takeGearAdded } from '../pages/gear/gear-added';
import type { WindowChanges } from '../pages/plans/ObsWindowSheet.vue';
import { filterColor } from '../filter-color';
import { useConfirm } from './useConfirm';
import { useErrorToast } from './useErrorToast';

/**
 * The observation windows of a plan's item (a target or a mosaic), as its page shows them (boards "Plan, détail d'une
 * cible", "Plan, détail d'une mosaïque" and "Plan, fenêtre d'observation"): the rows, the chart's bands, and the window
 * sheet (a tap opens one; the plus adds one, stored only when its sheet's "Enregistrer" is tapped). A window's "Ajouter un
 * filtre" leaves for the filter's add page with the window as edited; `resume` (called when the page is entered again)
 * opens it again, the filter saved there chosen. `save` writes the item's whole list of windows.
 */
export function usePlanWindows(options: {
  stored: () => readonly ObservationWindow[];
  night: () => { start: Date; end: Date } | null;
  save: (next: ObservationWindow[]) => Promise<void>;
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { showError } = useErrorToast();

  const editingId = ref<string | null>(null);
  const editorOpen = ref(false);
  /** The window shown instead of the stored one: a window being added, or one edited before leaving to add a filter. */
  const draft = ref<ObservationWindow | null>(null) as Ref<ObservationWindow | null>;
  /** The draft is a window being added: stored only when its sheet's "Enregistrer" is tapped. */
  const isNew = ref(false);
  /** The editor closed to add a filter: its draft waits for the way back. */
  const addingFilter = ref(false);
  watch(editorOpen, (isOpen) => {
    if (isOpen || addingFilter.value) return;
    draft.value = null;
    isNew.value = false;
  });

  /** The window's colour dot: the one chosen, else its filter's. */
  const colorOf = (w: ObservationWindow) => w.color || filterColor(w.filter);

  const rows = computed(() =>
    [...options.stored()]
      .sort((a, b) => a.startFrac - b.startFrac)
      .map((w) => {
        const win = options.night();
        const span = win ? win.end.getTime() - win.start.getTime() : 0;
        const frames = win ? framesInWindow(w, span) : null;
        return {
          w,
          title: w.filter || t('targets.plan.obsWindowTitle'),
          range: win ? `${fracToClock(w.startFrac, win)} – ${fracToClock(w.endFrac, win)}` : '',
          frames: w.frameSeconds && frames !== null ? `${frames} × ${w.frameSeconds} s` : '',
          color: colorOf(w),
        };
      }),
  );
  /** The windows as bands of the altitude chart, in their colours. */
  const chartWindows = computed(() =>
    rows.value.map((row) => ({
      startFrac: row.w.startFrac,
      endFrac: row.w.endFrac,
      color: row.color,
    })),
  );
  const editing = computed(() =>
    draft.value && draft.value.id === editingId.value
      ? draft.value
      : (options.stored().find((w) => w.id === editingId.value) ?? null),
  );

  function openWindow(id: string) {
    editingId.value = id;
    editorOpen.value = true;
  }

  function addWindow() {
    draft.value = newObservationWindow();
    isNew.value = true;
    openWindow(draft.value.id);
  }

  function addFilter(changes: WindowChanges) {
    const shown = editing.value;
    if (!shown) return;
    draft.value = { ...shown, ...changes };
    addingFilter.value = true;
    editorOpen.value = false;
    void router.push('/settings/gear/filter/new');
  }

  /** Back from the filter's add page: the window opens again as it was, with the filter saved there (if any). */
  async function resume() {
    if (!addingFilter.value) return;
    addingFilter.value = false;
    const id = takeGearAdded('filter');
    if (id && draft.value) {
      const added = (await getFilters()).find((f) => f.id === id);
      if (added) draft.value = { ...draft.value, filter: filterLabel(added) };
    }
    if (draft.value) openWindow(draft.value.id);
  }

  async function saveWindow(changes: WindowChanges) {
    const id = editingId.value;
    const added = isNew.value ? draft.value : null;
    editorOpen.value = false;
    if (!id) return;
    const stored = options.stored();
    try {
      await options.save(
        added
          ? [...stored, { ...added, ...changes }]
          : stored.map((w) => (w.id === id ? { ...w, ...changes } : w)),
      );
    } catch (error) {
      void showError(error);
    }
  }

  async function deleteWindow() {
    const id = editingId.value;
    if (!id) return;
    // The editor stays open under the question: "Annuler" leaves it as it was.
    const sure = await confirm({
      title: t('targets.plan.obsWindowRemove'),
      message: t('mobile.plans.deleteWindowMessage'),
      confirmLabel: t('mobile.plans.delete'),
      destructive: true,
    });
    if (!sure) return;
    editorOpen.value = false;
    try {
      await options.save(options.stored().filter((w) => w.id !== id));
    } catch (error) {
      void showError(error);
    }
  }

  return {
    rows,
    chartWindows,
    editing,
    editorOpen,
    isNew,
    openWindow,
    addWindow,
    addFilter,
    resume,
    saveWindow,
    deleteWindow,
  };
}
