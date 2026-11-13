<template>
  <!-- "Ciels affichés": which skies the map and the gallery show, in its own section once a sky has been visited. -->
  <CollapsibleSection
    v-if="store.skies.length > 0"
    :title="t('sharedSky.viewLabel')"
    :default-open="true"
  >
    <!-- The same space below the button as below the Photos section's searches. -->
    <div class="pb-[var(--space-10)]">
      <SkyViewSelect />
    </div>
  </CollapsibleSection>
</template>

<script setup lang="ts">
import CollapsibleSection from '../base/CollapsibleSection.vue';
import SkyViewSelect from './SkyViewSelect.vue';
import { t } from '../../i18n';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';

const store = useSharedSkiesStore();
</script>
