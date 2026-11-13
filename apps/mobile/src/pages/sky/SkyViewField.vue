<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { skyChoiceOptions } from '@myastrosky/core/shared-sky-view';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import SkyCheckSheet from './SkyCheckSheet.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';

// "Ciels affichés" (boards "Ciel, affichage, ciels affichés" and "Galerie, affichage, ciels affichés"): which skies the
// map and the gallery show, the user's own and any visited ones, ticked in the sheet "Ciel, choix des ciels affichés"
// like the Catalogues. Shown only once a sky has been visited, as its own section, first in the sheet. Unticking every
// sky shows no photo.

const store = useSharedSkiesStore();
const open = ref(false);
const options = computed(() =>
  skyChoiceOptions(store.skies).map((option) => ({
    value: option.value,
    label: option.labelKey ? t(option.labelKey) : (option.label ?? ''),
  })),
);
const shown = computed(() => store.shown.length);

function choose(values: string[]) {
  store.show(values).catch((error) => reportError('shared_sky_show', error));
}
</script>

<template>
  <template v-if="store.skies.length > 0">
    <PhoneSectionHeader>{{ t('sharedSky.viewLabel') }}</PhoneSectionHeader>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          t('mobile.targets.countAria', {
            label: t('sharedSky.viewSkies'),
            n: shown,
            total: options.length,
          })
        "
        @click="open = true"
      >
        <span class="mob-btn-key">{{ t('sharedSky.viewSkies') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          t('mobile.targets.countOf', { n: shown, total: options.length })
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <SkyCheckSheet
      v-model:open="open"
      :title="t('sharedSky.viewLabel')"
      :options="options"
      :selected="store.shown"
      @update:selected="choose"
    />
  </template>
</template>
