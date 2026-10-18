<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { loadServerSettings } from '@myastrosky/app-state/api';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';

// The boards "Importer, méthode de placement" and "Résolution en ligne, hors connexion": the four ways to place a
// photo. Solving online needs a connection and the astrometry.net key; without one of them the row is greyed out with
// the reason under it. Identifying stars has its own page, and placing by hand is done on the sky map. Solving on the
// computer needs the connection to the computer: that row is drawn and does nothing yet.
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ online: []; identify: []; hand: [] }>();

const online = ref(true);
const keySet = ref(true);

// What solving online needs is read each time the sheet opens.
watch(
  open,
  async (isOpen) => {
    if (!isOpen) return;
    online.value = navigator.onLine;
    try {
      keySet.value = (await loadServerSettings()).apiKeySet;
    } catch (error) {
      reportError('PlacementMethodSheet.loadServerSettings', error);
    }
  },
  { immediate: true },
);

const onlineReason = () =>
  !online.value
    ? t('mobile.gallery.offline')
    : !keySet.value
      ? t('modal.solverNoApiKey')
      : t('mobile.gallery.solveOnlineSub');

function chooseIdentify() {
  open.value = false;
  emit('identify');
}

function chooseHand() {
  open.value = false;
  emit('hand');
}

function chooseOnline() {
  // A greyed-out row still receives the tap.
  if (!online.value || !keySet.value) return;
  open.value = false;
  emit('online');
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('mobile.gallery.placeHow')">
    <PhoneRow
      button
      wrap
      :disabled="!online || !keySet"
      :title="t('mobile.gallery.solveOnline')"
      :subs="[onlineReason()]"
      @click="chooseOnline"
    />
    <PhoneRow
      disabled
      wrap
      :title="t('mobile.gallery.solveComputer')"
      :subs="[t('mobile.gallery.solveComputerSub')]"
    />
    <PhoneRow
      button
      wrap
      :title="t('mobile.gallery.identifyStars')"
      :subs="[t('mobile.gallery.identifyStarsSub')]"
      @click="chooseIdentify"
    />
    <PhoneRow
      button
      wrap
      :title="t('mobile.gallery.placeByHand')"
      :subs="[t('mobile.gallery.placeByHandSub')]"
      @click="chooseHand"
    />
  </PhoneSheet>
</template>
