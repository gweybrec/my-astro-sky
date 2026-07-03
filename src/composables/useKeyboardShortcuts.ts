import { onMounted, onUnmounted } from 'vue';
import { useCanvasStore } from '../stores/canvas';
import { useDisplayStore } from '../stores/display';
import { useUiStore } from '../stores/ui';
import { useShortcutsStore } from '../stores/shortcuts';
import { useSkyTimeStore } from '../stores/sky-time';
import { openVueModal } from '../modal-host';
import { normalizeKey, type ShortcutActionId } from '../keyboard-shortcuts';

export function useKeyboardShortcuts() {
  const canvasStore = useCanvasStore();
  const displayStore = useDisplayStore();
  const uiStore = useUiStore();
  const shortcutsStore = useShortcutsStore();
  const skyTimeStore = useSkyTimeStore();

  function runAction(id: ShortcutActionId): boolean {
    // Opening the cheat-sheet works regardless of the active view.
    if (id === 'openShortcuts') {
      openVueModal('shortcuts');
      return true;
    }

    const sm = canvasStore.skyMap;
    if (!sm || uiStore.currentViewMode !== 'skymap') return false;
    const view = sm.getView();

    switch (id) {
      case 'toggleStars':
        displayStore.setShowStars(!displayStore.showStars);
        return true;
      case 'toggleConstellationLines':
        displayStore.setShowConstellationLines(!displayStore.showConstellationLines);
        return true;
      case 'toggleConstellationNames':
        displayStore.setShowConstellationNames(!displayStore.showConstellationNames);
        return true;
      case 'toggleDSOs':
        displayStore.setShowDSOs(!displayStore.showDSOs);
        return true;
      case 'toggleDSOLabels':
        displayStore.setShowDSOLabels(!displayStore.showDSOLabels);
        return true;
      case 'toggleStarLabels':
        displayStore.setShowStarLabels(!displayStore.showStarLabels);
        return true;
      case 'toggleGrid':
        displayStore.setShowGrid(!displayStore.showGrid);
        return true;
      case 'togglePhotos':
        displayStore.setShowPhotos(!displayStore.showPhotos);
        return true;
      case 'togglePhotoOutlines':
        displayStore.setShowPhotoOutlines(!displayStore.showPhotoOutlines);
        return true;
      case 'togglePanel':
        uiStore.setPanelCollapsed(!uiStore.panelCollapsed);
        return true;
      case 'zoomIn':
        sm.zoomBy(1.3);
        return true;
      case 'zoomOut':
        sm.zoomBy(1 / 1.3);
        return true;
      case 'panLeft':
        sm.panBy(-view.width * 0.1, 0);
        return true;
      case 'panRight':
        sm.panBy(view.width * 0.1, 0);
        return true;
      case 'panUp':
        sm.panBy(0, -view.height * 0.1);
        return true;
      case 'panDown':
        sm.panBy(0, view.height * 0.1);
        return true;
      case 'toggleDateMode':
        skyTimeStore.toggleMode();
        return true;
      case 'toggleMoon':
        skyTimeStore.setShowMoon(!skyTimeStore.showMoon);
        return true;
      case 'timeSpeedForward':
        skyTimeStore.stepRateForward();
        return true;
      case 'timeSpeedBackward':
        skyTimeStore.stepRateBackward();
        return true;
      case 'timeStop':
        skyTimeStore.stopTime();
        return true;
      case 'jumpToEvening':
        skyTimeStore.jumpToEvening();
        return true;
      default:
        return false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // Don't hijack keys while typing or while a modal is open (the modal owns its keys,
    // including the rebind-capture flow in KeyboardShortcutsModal).
    const el = document.activeElement as HTMLElement | null;
    const tag = (el?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
    if (uiStore.isModalOpen()) return;

    const key = normalizeKey(e);
    if (!key) return;

    const ids = shortcutsStore.keyToAction.get(key);
    if (!ids || ids.length === 0) return;

    // A key may be bound to several actions (the user chose to keep a duplicate) — run
    // them all so the shortcut performs every assigned action.
    let handled = false;
    for (const id of ids) {
      if (runAction(id)) handled = true;
    }
    if (handled) e.preventDefault();
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown));
}
