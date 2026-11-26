<script setup lang="ts">
import { computed } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { LiveOptions } from '@myastrosky/core/targets/live-plan';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneStepperRow from '../../components/PhoneStepperRow.vue';

// The section "Alertes" of tonight's plan (boards "Plan, détail, ce soir" and "Plan, en direct"): the reminder before
// the end of each target and the alert before the meridian, with its minutes. The same for every plan, remembered
// between nights; a change while the plan runs moves the alerts to come at once.
const live = useLivePlanStore();
const options = computed(() => live.state?.options ?? live.lastOptions);
function set<K extends keyof LiveOptions>(key: K, value: LiveOptions[K]) {
  live.setOptions({ ...options.value, [key]: value });
}
</script>

<template>
  <PhoneSectionHeader>{{ t('live.alerts') }}</PhoneSectionHeader>
  <IonList class="mob-list" lines="none">
    <PhoneToggleRow
      :title="t('live.remind')"
      :model-value="options.remindBeforeEnd"
      @update:model-value="set('remindBeforeEnd', $event)"
    />
    <PhoneToggleRow
      :title="t('live.meridian')"
      :model-value="options.meridianFlip"
      @update:model-value="set('meridianFlip', $event)"
    />
    <PhoneStepperRow
      :label="t('live.meridianMinutes')"
      :less-label="t('live.fewerMinutes')"
      :more-label="t('live.moreMinutes')"
      :min="5"
      :max="30"
      :step="5"
      :model-value="options.meridianMinutes"
      @update:model-value="set('meridianMinutes', $event)"
    />
  </IonList>
</template>
