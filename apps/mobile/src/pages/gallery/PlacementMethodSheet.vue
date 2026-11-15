<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { loadServerSettings } from '@myastrosky/app-state/api';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Importer, méthode de placement" and "Importer, hors connexion": the ways to place a photo. Solving online
// and reusing a solution of the astrometry.net account need a connection and the key; without one of them both rows are
// greyed out with the reason under them. Reusing a solution has its own page. Identifying stars has its own page, and placing by hand is done on the sky map. Solving on the
// computer (and the connection it needs) is postponed to a later release: no row for it. A photo already kept as waiting
// (`deletable`, the gallery's) can also be deleted from the red last row (`delete`; the page asks first).
const open = defineModel<boolean>('open', { required: true });
defineProps<{ deletable?: boolean }>();
const emit = defineEmits<{ online: []; reuse: []; identify: []; hand: []; delete: [] }>();

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

/** Why the rows that use astrometry.net are greyed out; null when they can be used. */
const unavailableReason = () =>
  !online.value ? t('mobile.gallery.offline') : !keySet.value ? t('modal.solverNoApiKey') : null;
const onlineReason = () => unavailableReason() ?? t('mobile.gallery.solveOnlineSub');
const reuseReason = () => unavailableReason() ?? t('mobile.gallery.reuseSolutionSub');

function chooseIdentify() {
  open.value = false;
  emit('identify');
}

function chooseHand() {
  open.value = false;
  emit('hand');
}

function chooseDelete() {
  open.value = false;
  emit('delete');
}

function chooseOnline() {
  // A greyed-out row still receives the tap.
  if (unavailableReason()) return;
  open.value = false;
  emit('online');
}

function chooseReuse() {
  if (unavailableReason()) return;
  open.value = false;
  emit('reuse');
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
      button
      wrap
      :disabled="!online || !keySet"
      :title="t('mobile.gallery.reuseSolution')"
      :subs="[reuseReason()]"
      @click="chooseReuse"
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
    <PhoneRow
      v-if="deletable"
      button
      danger
      :lead="trashIcon"
      :title="t('photos.deleteThisPhoto')"
      @click="chooseDelete"
    />
  </PhoneSheet>
</template>
