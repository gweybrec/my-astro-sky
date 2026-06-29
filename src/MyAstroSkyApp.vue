<template>
  <!-- Phase 2: panel header teleported into #vue-panel-header -->
  <Teleport to="#vue-panel-header">
    <PanelHeader />
  </Teleport>

  <!-- Phase 7: photos section teleported into #vue-photos-section -->
  <Teleport to="#vue-photos-section">
    <PhotosSection />
  </Teleport>

  <!-- Phase 8: unified search teleported into #vue-search-section -->
  <Teleport to="#vue-search-section">
    <UnifiedSearch />
  </Teleport>

  <!-- Phase 3: display controls section teleported into #vue-display-section -->
  <Teleport to="#vue-display-section">
    <DisplayControlsSection />
  </Teleport>

  <!-- Performance section (density sliders + auto) at the bottom of the panel -->
  <Teleport to="#vue-performance-section">
    <PerformanceSection />
  </Teleport>

  <!-- Phase 5: settings modal -->
  <SettingsModal v-if="activeModal === 'settings'" @close="closeModal()" />
  <SolverSettingsModal v-if="activeModal === 'solverSettings'" @close="closeModal()" />

  <!-- Phase 9: export / import modals -->
  <ExportModal v-if="activeModal === 'export'" @close="closeModal()" />
  <ImportModal v-if="activeModal === 'import'" @close="closeModal()" />

  <!-- Phase 10: delete all data modal -->
  <DeleteAllDataModal v-if="activeModal === 'deleteAll'" @close="closeModal()" />

  <!-- Gallery filter bar (search + label/type/catalog dropdowns) -->
  <Teleport to="#gallery-filter-bar">
    <GalleryFilterBar />
  </Teleport>

  <!-- Phase 11: floating map controls (teleported to #app) -->
  <FloatingControls />

  <!-- Sky tooltip (driven by canvas hover callbacks via useUiStore) -->
  <SkyTooltip />

  <!-- Phase 12: batch upload modal -->
  <BatchUploadModal v-if="activeModal === 'batchUpload'" @close="closeModal()" />

  <!-- Phase 1: static informational modals -->
  <AboutModal v-if="activeModal === 'about'" @close="closeModal()" />
  <PrivacyModal v-if="activeModal === 'privacy'" @close="closeModal()" />
  <DataCreditsModal v-if="activeModal === 'credits'" @close="closeModal()" />

  <!-- In-app update check (opened on startup when a newer release exists) -->
  <UpdateAvailableModal v-if="activeModal === 'update'" @close="closeModal()" />

  <!-- Keyboard shortcuts cheat-sheet + remap -->
  <KeyboardShortcutsModal v-if="activeModal === 'shortcuts'" @close="closeModal()" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts';
import PanelHeader from './components/panels/PanelHeader.vue';
import PhotosSection from './components/panels/PhotosSection.vue';
import DisplayControlsSection from './components/panels/DisplayControlsSection.vue';
import PerformanceSection from './components/panels/PerformanceSection.vue';
import UnifiedSearch from './components/panels/UnifiedSearch.vue';
import SettingsModal from './components/modals/SettingsModal.vue';
import SolverSettingsModal from './components/modals/SolverSettingsModal.vue';
import ExportModal from './components/modals/ExportModal.vue';
import ImportModal from './components/modals/ImportModal.vue';
import DeleteAllDataModal from './components/modals/DeleteAllDataModal.vue';
import FloatingControls from './components/overlay/FloatingControls.vue';
import GalleryFilterBar from './components/panels/GalleryFilterBar.vue';
import SkyTooltip from './components/overlay/SkyTooltip.vue';
import BatchUploadModal from './components/modals/BatchUploadModal.vue';
import AboutModal from './components/modals/AboutModal.vue';
import PrivacyModal from './components/modals/PrivacyModal.vue';
import DataCreditsModal from './components/modals/DataCreditsModal.vue';
import UpdateAvailableModal from './components/modals/UpdateAvailableModal.vue';
import KeyboardShortcutsModal from './components/modals/KeyboardShortcutsModal.vue';

type ModalName ='settings' | 'solverSettings' | 'export' | 'import' | 'deleteAll' | 'batchUpload' | 'about' | 'privacy' | 'credits' | 'update' | 'shortcuts';

const activeModal = ref<ModalName | null>(null);
const previousModal = ref<ModalName | null>(null);
useKeyboardShortcuts();

function openModal(name: ModalName | null) {
  previousModal.value = activeModal.value;
  activeModal.value = name;
}

function closeModal() {
  activeModal.value = previousModal.value;
  previousModal.value = null;
}

defineExpose({ openModal });
</script>
