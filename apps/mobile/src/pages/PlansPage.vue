<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { getPlans } from '@myastrosky/app-state/api';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
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
    <PhoneTopBar>
      <PhoneSearch
        :placeholder="t('mobile.plans.searchPlaceholder')"
        :label="t('mobile.plans.searchLabel')"
      />
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <!-- Creating a plan is a later card: the button shows and does nothing yet. -->
        <PhoneEmptyState
          v-if="planCount === 0"
          :text="t('targets.plan.noPlans')"
          :button-label="t('targets.plan.newPlan')"
          :button-icon="plusIcon"
        />
      </div>
    </IonContent>
  </IonPage>
</template>
