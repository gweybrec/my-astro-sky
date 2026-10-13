<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { loadServerSettings } from '@myastrosky/app-state/api';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';

// The boards "Importer, méthode de placement" and "Résolution en ligne, hors connexion": the four ways to place a
// photo. Solving online needs a connection and the astrometry.net key; without one of them the row is greyed out with
// the reason under it. Solving on the computer needs the connection to the computer, and the two manual methods their
// screens on the sky map: those three rows are drawn and do nothing yet.
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ online: [] }>();

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
      inert
      wrap
      :title="t('mobile.gallery.identifyStars')"
      :subs="[t('mobile.gallery.identifyStarsSub')]"
    />
    <PhoneRow
      inert
      wrap
      :title="t('mobile.gallery.placeByHand')"
      :subs="[t('mobile.gallery.placeByHandSub')]"
    />
  </PhoneSheet>
</template>
