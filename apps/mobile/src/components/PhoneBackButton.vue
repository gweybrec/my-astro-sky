<script setup lang="ts">
import { useRouter } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import PhoneIconButton from './PhoneIconButton.vue';
import AppIcon from './AppIcon.vue';
import backIcon from '../icons/arrow-left.svg?raw';

// The back arrow at the left of a pushed page's top bar (an icon button of the design system). It goes back one
// page in the history, as the Android back button does; `fallback` is where it goes when there is nothing to go back
// to (the page was opened directly). In a mode of a screen (placing a photo, choosing a star), `action` is done instead:
// the mode's own way out, as its Annuler button and the Android back button.
const props = defineProps<{
  fallback?: string;
  action?: () => void;
  /** Asked before leaving (a form with changes that are not saved): the page is left only when it answers true. */
  before?: () => Promise<boolean>;
}>();
const router = useRouter();

async function goBack() {
  if (props.before && !(await props.before())) return;
  if (props.action) props.action();
  else if (window.history.state?.back) router.back();
  else void router.replace(props.fallback ?? '/tabs/sky');
}
</script>

<template>
  <PhoneIconButton :label="t('mobile.nav.back')" @click="goBack">
    <AppIcon :svg="backIcon" />
  </PhoneIconButton>
</template>
