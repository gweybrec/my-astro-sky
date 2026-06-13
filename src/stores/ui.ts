import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ViewMode } from '../types';
import { useCanvasStore } from './canvas';

export const useUiStore = defineStore('ui', () => {
  const canvasStore = useCanvasStore();

  const openModalName = ref<string | null>(null);
  const hasOpenModal = computed(() => openModalName.value !== null);

  const panelCollapsed = ref(false);
  const currentViewMode = ref<ViewMode>('skymap');
  const pendingBatchFiles = ref<File[] | null>(null);

  // Update-available info, set by the startup version check and read by UpdateAvailableModal.
  const pendingUpdate = ref<{ latest: string; url: string } | null>(null);

  // Sky tooltip state — set by canvas hover callbacks in ui.ts
  const skyTooltipHtml = ref<string | null>(null);
  const skyTooltipX = ref(0);
  const skyTooltipY = ref(0);
  const _forceSuppressTooltip = ref(false);
  const suppressSkyTooltip = computed(() => hasOpenModal.value || _forceSuppressTooltip.value);

  function registerModal(name: string) {
    openModalName.value = name;
  }

  function unregisterModal() {
    openModalName.value = null;
  }

  function setSkyTooltip(html: string | null, x: number, y: number) {
    skyTooltipHtml.value = html;
    skyTooltipX.value = x;
    skyTooltipY.value = y;
  }

  function setForceSuppressTooltip(v: boolean) {
    _forceSuppressTooltip.value = v;
  }

  function setPanelCollapsed(collapsed: boolean) {
    panelCollapsed.value = collapsed;
    document.getElementById('side-panel')?.classList.toggle('collapsed', collapsed);
    const btn = document.getElementById('toggle-panel');
    if (btn) btn.textContent = collapsed ? '◀' : '▶';
    window.dispatchEvent(new CustomEvent('panelToggled', { detail: { collapsed } }));
  }

  function switchView(mode: ViewMode) {
    const prev = currentViewMode.value;
    const sidePanel = document.getElementById('side-panel');

    currentViewMode.value = mode;

    document.getElementById('tab-skymap')?.classList.toggle('active', mode === 'skymap');
    document.getElementById('tab-gallery')?.classList.toggle('active', mode === 'gallery');
    document.getElementById('tab-targets')?.classList.toggle('active', mode === 'targets');

    const mapContainer = document.getElementById('map-container');
    if (mapContainer) mapContainer.style.display = mode === 'skymap' ? 'block' : 'none';

    canvasStore.skyMap?.setInteractionEnabled(mode === 'skymap');

    if (mode === 'gallery') {
      canvasStore.gallery?.show();
      canvasStore.targetsView?.hide();
    } else if (mode === 'targets') {
      canvasStore.gallery?.hide();
      canvasStore.targetsView?.show();
    } else {
      canvasStore.gallery?.hide();
      canvasStore.targetsView?.hide();
    }

    const panelVisible = mode === 'skymap';
    if (sidePanel) sidePanel.style.display = panelVisible ? '' : 'none';
    const toggleBtn = document.getElementById('toggle-panel');
    if (toggleBtn) toggleBtn.style.display = panelVisible ? '' : 'none';

    window.dispatchEvent(new CustomEvent('viewModeChanged', { detail: { mode } }));
  }

  return {
    openModalName, hasOpenModal, registerModal, unregisterModal,
    panelCollapsed, currentViewMode, setPanelCollapsed, switchView,
    pendingBatchFiles, pendingUpdate,
    skyTooltipHtml, skyTooltipX, skyTooltipY, suppressSkyTooltip,
    setSkyTooltip, setForceSuppressTooltip,
  };
});
