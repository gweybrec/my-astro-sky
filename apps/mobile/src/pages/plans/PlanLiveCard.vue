<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { liveCard } from '@myastrosky/core/targets/live-plan';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneButton from '../../components/PhoneButton.vue';

// The live card at the top of a started plan (boards "Plan, en direct", "avant le début", "pause"): what is imaged now
// and until when, its progress, what comes next, and Passer / +10 min (only while a target is imaged) / Arrêter.
const live = useLivePlanStore();
const card = computed(() =>
  liveCard(live.status, live.slots, live.now, t, (ms) => formatClock24(new Date(ms))),
);
const imaging = computed(() => live.status.kind === 'active');

/** A line cut around its clock times, which are drawn in figures. */
function parts(text: string): { text: string; mono: boolean }[] {
  return text
    .split(/(\d{1,2}:\d{2})/)
    .filter(Boolean)
    .map((p) => ({ text: p, mono: /^\d{1,2}:\d{2}$/.test(p) }));
}
</script>

<template>
  <PhoneSectionHeader>{{ t('live.section') }}</PhoneSectionHeader>
  <div class="mob-row mob-live-card">
    <span class="mob-row-body">
      <span class="mob-row-title m-title mob-live-title"
        ><template v-for="(p, i) in parts(card.title)" :key="i"
          ><span v-if="p.mono" class="m-mono">{{ p.text }}</span
          ><template v-else>{{ p.text }}</template></template
        ></span
      >
      <span v-if="card.line" class="mob-row-sub mob-row-sub--wrap m-secondary"
        ><template v-for="(p, i) in parts(card.line)" :key="i"
          ><span v-if="p.mono" class="m-mono">{{ p.text }}</span
          ><template v-else>{{ p.text }}</template></template
        ></span
      >
      <span
        v-if="card.progress !== null"
        class="mob-progress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(card.progress * 100)"
        ><span class="mob-progress-bar" :style="{ '--progress': card.progress }"
      /></span>
      <span v-if="card.next" class="mob-row-sub mob-row-sub--wrap m-secondary mob-live-next"
        ><template v-for="(p, i) in parts(card.next)" :key="i"
          ><span v-if="p.mono" class="m-mono">{{ p.text }}</span
          ><template v-else>{{ p.text }}</template></template
        ></span
      >
      <span class="mob-row-actions">
        <template v-if="imaging">
          <PhoneButton @click="live.skip()">{{ t('live.skip') }}</PhoneButton>
          <PhoneButton @click="live.extend()">{{ t('live.extend') }}</PhoneButton>
        </template>
        <PhoneButton @click="live.stop()">{{ t('live.stop') }}</PhoneButton>
      </span>
    </span>
  </div>
</template>
