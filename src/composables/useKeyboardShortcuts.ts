import { onMounted, onUnmounted } from 'vue';
import { useCanvasStore } from '../stores/canvas';
import { useDisplayStore } from '../stores/display';
import { useUiStore } from '../stores/ui';

export function useKeyboardShortcuts() {
  const canvasStore = useCanvasStore();
  const displayStore = useDisplayStore();
  const uiStore = useUiStore();

  function onKeydown(e: KeyboardEvent) {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    const sm = canvasStore.skyMap;
    if (!sm) return;
    const view = sm.getView();

    switch (e.key) {
      case '+': case '=': e.preventDefault(); sm.zoomBy(1.3); break;
      case '-': e.preventDefault(); sm.zoomBy(1 / 1.3); break;
      case 'ArrowLeft': e.preventDefault(); sm.panBy(-view.width * 0.1, 0); break;
      case 'ArrowRight': e.preventDefault(); sm.panBy(view.width * 0.1, 0); break;
      case 'ArrowUp': e.preventDefault(); sm.panBy(0, -view.height * 0.1); break;
      case 'ArrowDown': e.preventDefault(); sm.panBy(0, view.height * 0.1); break;
      case 'h': case 'H': uiStore.setPanelCollapsed(!uiStore.panelCollapsed); break;
      case 'g': case 'G': displayStore.setShowGrid(!sm.getShowGrid()); break;
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown));
}
