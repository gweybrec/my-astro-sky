<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { SLOW_SEARCH_MS } from '@myastrosky/core/photo-identify';
import PhoneBusy from '../../components/PhoneBusy.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';

// A search of an identification page that runs (shown while it does): a spinner with "Recherche…", and after
// SLOW_SEARCH_MS a line saying it still runs. The app waits up to a minute for SkyBoT, and a spinner alone for
// that long would look like a frozen app. As the desktop's identification modals. The line is scrolled into the panel's
// view when it appears (in landscape the panel may be full).
const slow = ref(false);
const line = ref<InstanceType<typeof PhoneHelper> | null>(null);
const timer = setTimeout(async () => {
  slow.value = true;
  await nextTick();
  (line.value?.$el as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
}, SLOW_SEARCH_MS);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <PhoneHelper><PhoneBusy :label="t('identify.searching')" /></PhoneHelper>
  <PhoneHelper v-if="slow" ref="line">{{ t('identify.stillSearching') }}</PhoneHelper>
</template>
