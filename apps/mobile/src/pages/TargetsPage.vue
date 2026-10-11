<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import filterIcon from '../icons/filter.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
</script>

<template>
  <!-- The board "Cibles, aucun setup": nothing is configured yet. -->
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        :placeholder="t('mobile.targets.searchPlaceholder')"
        :label="t('mobile.targets.searchLabel')"
      />
      <PhoneIconButton :label="t('targets.moreFilters')"
        ><AppIcon :svg="filterIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <div class="mob-context" style="flex: none">
      <PhoneButton variant="field">
        <span class="mob-btn-label">{{ t('targets.gear.noSetup') }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
      <PhoneButton variant="field">
        <span class="mob-btn-label">{{ t('mobile.targets.tonight') }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill" style="background: var(--bg-panel)">
        <!-- Adding a setup is a later card: the button shows and does nothing yet. -->
        <PhoneEmptyState
          :text="t('fovOverlay.noSetups')"
          :button-label="t('fovOverlay.addSetup')"
          :button-icon="plusIcon"
        />
      </div>
    </IonContent>
  </IonPage>
</template>
