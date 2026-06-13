<template>
  <BaseModal :title="t('settings.aboutTitle')" size="wide" body-class="modal-form-body--loose" @close="$emit('close')">
    <div class="about-meta-block">
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[52px]">{{ t('settings.aboutVersionLabel') }}</span>
        {{ version }}
      </div>
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[52px]">{{ t('settings.aboutBuildLabel') }}</span>
        {{ build }}
      </div>
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[52px]">{{ t('settings.aboutAuthorLabel') }}</span>
        {{ author }}
      </div>
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[52px]">{{ t('settings.aboutLicenseLabel') }}</span>
        {{ license }}
      </div>
    </div>
    <p class="text-para">{{ t('settings.aboutDesc') }}</p>
    <ul class="about-features-list">
      <li v-for="(item, i) in features" :key="i">{{ item }}</li>
    </ul>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { useI18n } from '../../composables/useI18n';

defineEmits<{ close: [] }>();

const { t } = useI18n();

const version = __APP_VERSION__;
const build = __APP_BUILD_TIMESTAMP__;
const license = __APP_LICENSE__;
const author = computed(() =>
  __APP_AUTHOR_NAME__ + (__APP_AUTHOR_EMAIL__ ? ` · ${__APP_AUTHOR_EMAIL__}` : '')
);

const features = computed(() =>
  t('settings.aboutFeatures').split('·').map(s => s.trim()).filter(Boolean)
);
</script>

