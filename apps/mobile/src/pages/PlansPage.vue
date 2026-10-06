<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonPage, IonHeader, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { getPlans } from '@myastrosky/app-state/api';
import AppIcon from '../components/AppIcon.vue';
import plusIcon from '@icons/plus.svg?raw';

// null until the plans are read; the empty state shows only once the backend has answered with none.
const planCount = ref<number | null>(null);

onMounted(async () => {
  try {
    planCount.value = (await getPlans()).length;
  } catch (error) {
    reportError('PlansPage.getPlans', error);
  }
});
</script>

<template>
  <IonPage>
    <IonHeader class="mob-topbar">
      <input
        class="mob-search m-body"
        type="search"
        :placeholder="t('mobile.plans.searchPlaceholder')"
        :aria-label="t('mobile.plans.searchLabel')"
      />
    </IonHeader>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <div v-if="planCount === 0" class="mob-empty">
          <p class="mob-empty-text m-body">{{ t('targets.plan.noPlans') }}</p>
          <!-- Creating a plan is a later card: the button shows and does nothing yet. -->
          <button type="button" class="mob-btn mob-btn--action mob-btn--lg m-body-strong">
            <AppIcon :svg="plusIcon" />{{ t('targets.plan.newPlan') }}
          </button>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
