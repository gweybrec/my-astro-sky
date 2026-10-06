<script setup lang="ts">
import { IonPage, IonHeader, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from '../components/AppIcon.vue';
import filterIcon from '../icons/filter.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
</script>

<template>
  <!-- The board "Cibles, aucun setup": nothing is configured yet. -->
  <IonPage>
    <IonHeader class="mob-topbar">
      <input
        class="mob-search m-body"
        type="search"
        :placeholder="t('mobile.targets.searchPlaceholder')"
        :aria-label="t('mobile.targets.searchLabel')"
      />
      <button type="button" class="mob-icon-btn" :aria-label="t('targets.moreFilters')">
        <AppIcon :svg="filterIcon" />
      </button>
    </IonHeader>
    <div class="mob-context" style="flex: none">
      <button type="button" class="mob-btn mob-btn--field m-secondary">
        <span class="mob-btn-label">{{ t('targets.gear.noSetup') }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </button>
      <button type="button" class="mob-btn mob-btn--field m-secondary">
        <span class="mob-btn-label">{{ t('mobile.targets.tonight') }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </button>
    </div>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill" style="background: var(--bg-panel)">
        <div class="mob-empty">
          <p class="mob-empty-text m-body">{{ t('fovOverlay.noSetups') }}</p>
          <!-- Adding a setup is a later card: the button shows and does nothing yet. -->
          <button type="button" class="mob-btn mob-btn--action mob-btn--lg m-body-strong">
            <AppIcon :svg="plusIcon" />{{ t('fovOverlay.addSetup') }}
          </button>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
