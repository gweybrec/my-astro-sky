<template>
  <BaseModal
    :title="t('settings.dataCreditsTitle')"
    size="wide"
    body-class="modal-form-body"
    @close="$emit('close')"
  >
    <template v-for="section in sections" :key="section.label">
      <div class="credits-section-label">{{ section.label }}</div>
      <p v-if="section.intro" class="credits-section-intro">{{ section.intro }}</p>
      <div v-for="row in section.credits" :key="row.name" class="dep-row">
        <div class="dep-name">{{ row.name }}</div>
        <div class="dep-detail">
          <span>{{ row.detail }}</span>
          <a
            v-if="row.url"
            :href="row.url"
            target="_blank"
            rel="noopener noreferrer"
            class="settings-link"
            >{{ row.linkText }}</a
          >
          <a
            v-if="row.license && row.licenseUrl"
            :href="row.licenseUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="tag-chip-sm hover:text-[var(--settings-link-color)]"
            >{{ row.license }}</a
          >
          <span v-else-if="row.license" class="tag-chip-sm">{{ row.license }}</span>
        </div>
        <div v-if="row.note" class="dep-note">{{ row.note }}</div>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from '../base/BaseModal.vue';
import { useI18n } from '../../composables/useI18n';
import { dataCreditSections } from '@myastrosky/core/data-credits';

defineEmits<{ close: [] }>();

const { t } = useI18n();

const sections = dataCreditSections();
</script>
