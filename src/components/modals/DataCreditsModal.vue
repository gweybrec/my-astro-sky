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
  license?: string;
  licenseUrl?: string;
  note?: string;
}

const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const ETALAB_2 = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/';
const allRights = t('settings.dataCreditsLicenseAllRights');

const catalogRows: CreditRow[] = [
  {
    name: 'Stars — d3-celestial',
    detail: 'Olaf Frohn · Hipparcos data (ESA)',
    url: 'https://github.com/ofrohn/d3-celestial',
    linkText: 'github.com/ofrohn/d3-celestial',
    license: 'BSD 3-Clause',
    licenseUrl: 'https://github.com/ofrohn/d3-celestial/blob/master/LICENSE',
  },
  {
    name: 'Deep-sky objects — OpenNGC',
    detail: 'Mattia Verga',
    url: 'https://github.com/mattiaverga/OpenNGC',
    linkText: 'github.com/mattiaverga/OpenNGC',
    license: 'CC BY-SA 4.0',
    licenseUrl: CC_BY_SA_4,
  },
  {
    name: 'Coordinates — SIMBAD',
    detail: 'CDS, Université de Strasbourg',
    url: 'https://simbad.cds.unistra.fr',
    linkText: 'simbad.cds.unistra.fr',
    license: 'Etalab 2.0',
    licenseUrl: ETALAB_2,
  },
  {
    name: 'Coordinates — VizieR',
    detail: 'CDS, Université de Strasbourg',
    url: 'https://vizier.cds.unistra.fr',
    linkText: 'vizier.cds.unistra.fr',
    license: 'Etalab 2.0',
    licenseUrl: ETALAB_2,
  },
  {
    name: 'Constellation boundaries',
    detail: 'IAU · Eugène Delporte, 1930',
    license: t('settings.dataCreditsLicensePublicDomain'),
  },
  {
    name: 'Constellation figures — Stellarium sky cultures',
    detail: 'modern · H.A. Rey · Chinese',
    url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures',
    linkText: 'stellarium/skycultures',
    license: 'CC BY-SA 4.0',
    licenseUrl: CC_BY_SA_4,
  },
  {
    // Listed separately from the three CC BY-SA cultures above: al-Sufi is the
    // one sky culture Stellarium releases under a no-derivatives licence.
    name: 'Constellation figures — Arabic (al-Sufi)',
    detail: 'Stellarium sky culture · after ʿAbd al-Rahman al-Sufi, c. 964',
    url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures/arabic_al-sufi',
    linkText: 'stellarium/arabic_al-sufi',
    license: 'CC BY-ND 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
  },
];

const docRows: CreditRow[] = [
  { name: 'The 750 Best Deep Sky Objects', detail: '© 2024 Gary Imm', license: allRights },
  {
    name: 'Large PN Observing Atlas',
    detail: 'Reiner Vogel · version 03/2013',
    url: 'https://www.reinervogel.net/LargePN/LargePN_e.html',
    linkText: 'reinervogel.net',
    license: allRights,
    note: t('settings.dataCreditsLargePnNote'),
  },
  {
    name: 'Finest NGC Chart/Log System',
    detail: 'Terry Adrian · © Royal Astronomical Society of Canada',
    url: 'https://www.rasc.ca/finest-ngc-objects',
    linkText: 'rasc.ca/finest-ngc-objects',
    license: allRights,
  },
];
</script>
