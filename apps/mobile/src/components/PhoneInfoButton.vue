<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneIconButton from './PhoneIconButton.vue';
import AppIcon from './AppIcon.vue';
import infoIcon from '../icons/info.svg?raw';
import { showInfo } from '../composables/useConfirm';

// The "i" button: long explanatory texts sit behind it, in the small dialog of the board "Identification,
// explication ouverte".
const props = defineProps<{ title: string; message: string }>();
</script>

<template>
  <PhoneIconButton
    :label="t('mobile.info.label', { title: props.title })"
    @click="showInfo(props.title, props.message)"
  >
    <AppIcon :svg="infoIcon" />
  </PhoneIconButton>
</template>
