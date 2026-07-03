<template>
  <BaseModal
    :title="t('settings.dataCreditsTitle')"
    size="wide"
    body-class="modal-form-body"
    @close="$emit('close')"
  >
    <div class="credits-section-label">{{ t('settings.dataCreditsCatalogsLabel') }}</div>
    <div v-for="row in catalogRows" :key="row.name" class="dep-row">
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
      </div>
    </div>

    <div class="credits-section-label">{{ t('settings.dataCreditsDocsLabel') }}</div>
    <div v-for="row in docRows" :key="row.name" class="dep-row">
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
      </div>
      <div v-if="row.note" class="dep-note">{{ row.note }}</div>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from '../base/BaseModal.vue';
import { useI18n } from '../../composables/useI18n';

defineEmits<{ close: [] }>();

const { t } = useI18n();

interface CreditRow {
  name: string;
  detail: string;
  url?: string;
  linkText?: string;
  note?: string;
}

const catalogRows: CreditRow[] = [
  {
    name: 'Stars — d3-celestial',
    detail: 'Olaf Frohn · Hipparcos data (ESA)',
    url: 'https://github.com/ofrohn/d3-celestial',
    linkText: 'github.com/ofrohn/d3-celestial',
  },
  {
    name: 'Deep-sky objects — OpenNGC',
    detail: 'Mattia Verga',
    url: 'https://github.com/mattiaverga/OpenNGC',
    linkText: 'github.com/mattiaverga/OpenNGC',
  },
  {
    name: 'Coordinates — SIMBAD',
    detail: 'CDS, Université de Strasbourg',
    url: 'https://simbad.cds.unistra.fr',
    linkText: 'simbad.cds.unistra.fr',
  },
  {
    name: 'Coordinates — VizieR',
    detail: 'CDS, Université de Strasbourg',
    url: 'https://vizier.cds.unistra.fr',
    linkText: 'vizier.cds.unistra.fr',
  },
  { name: 'Constellation boundaries', detail: 'IAU · Eugène Delporte, 1930' },
];

const docRows: CreditRow[] = [
  { name: 'The 750 Best Deep Sky Objects', detail: '© 2024 Gary Imm' },
  {
    name: 'Large PN Observing Atlas',
    detail: 'Reiner Vogel · version 03/2013',
    url: 'https://www.reinervogel.net/LargePN/LargePN_e.html',
    linkText: 'reinervogel.net',
    note: t('settings.dataCreditsLargePnNote'),
  },
  {
    name: 'Finest NGC Chart/Log System',
    detail: 'Terry Adrian · © Royal Astronomical Society of Canada',
    url: 'https://www.rasc.ca/finest-ngc-objects',
    linkText: 'rasc.ca/finest-ngc-objects',
  },
];
</script>
