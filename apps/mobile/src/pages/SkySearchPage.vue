<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewDidEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { searchUnified, type UnifiedSearchResult } from '@myastrosky/core/search';
import { catalogsReady } from '../catalogs';
import { selectSearchResult } from '../composables/useSkySelection';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneTargetRow from '../components/PhoneTargetRow.vue';

// The board "Ciel, recherche": a star or a deep-sky object by name or catalogue number, the results listed as the
// targets of Cibles are (name, designation with the type and constellation, magnitude). A result is chosen with a tap:
// the map goes to it and selects it.
const router = useRouter();
const field = ref<InstanceType<typeof PhoneSearch> | null>(null);
const query = ref('');
const results = ref<UnifiedSearchResult[]>([]);
let debounce: ReturnType<typeof setTimeout> | undefined;

/** How long a pause in typing is waited for before searching. */
const SEARCH_DELAY_MS = 250;

watch(query, (value) => {
  clearTimeout(debounce);
  const text = value.trim();
  if (!text) {
    results.value = [];
    return;
  }
  debounce = setTimeout(async () => {
    try {
      await catalogsReady();
      const found = await searchUnified(text);
      if (query.value.trim() === text) results.value = found;
    } catch (error) {
      reportError('SkySearchPage.search', error);
    }
  }, SEARCH_DELAY_MS);
});

onIonViewDidEnter(() => field.value?.focus());
onBeforeUnmount(() => clearTimeout(debounce));

/** The designation line of a deep-sky object: its id and the other catalogues it is known as. */
function designation(result: UnifiedSearchResult): string | undefined {
  const { dso, star } = result;
  if (dso) {
    const others = dso.catalogs.slice(1).filter((c) => !c.startsWith('LPN-'));
    const cross = others.length ? ` (${others.join(' · ')})` : '';
    return dso.displayName
      ? `${dso.id}${cross}`
      : cross.trim().replace(/^\(|\)$/g, '') || undefined;
  }
  if (star?.name) {
    return star.bayer && star.constellation ? `${star.bayer} ${star.constellation}` : undefined;
  }
  return undefined;
}

function row(result: UnifiedSearchResult) {
  const { dso, star } = result;
  const magnitude = Number.isFinite(result.mag)
    ? `${t('stars.magnitude')} ${result.mag.toFixed(1)}`
    : undefined;
  if (dso) {
    return {
      title: dso.displayName || dso.id,
      designation: designation(result),
      typeLabel: t(`dso.types.${dso.type}`),
      constellation: dso.constellation?.toUpperCase(),
      magnitude,
    };
  }
  return {
    title: star?.name || result.label,
    designation: designation(result),
    typeLabel: undefined,
    constellation: star?.constellation?.toUpperCase(),
    magnitude,
  };
}

function choose(result: UnifiedSearchResult) {
  selectSearchResult(result);
  router.back();
}

const cancel = () => router.back();
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        ref="field"
        v-model="query"
        clearable
        :placeholder="t('search.placeholder')"
        :label="t('search.placeholder')"
      />
      <PhoneButton variant="text" @click="cancel">{{ t('modal.cancel') }}</PhoneButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-safe mob-page-pad">
        <PhoneTargetRow
          v-for="(result, index) in results"
          :key="`${result.type}-${index}-${result.label}`"
          v-bind="row(result)"
          @click="choose(result)"
        />
      </div>
    </IonContent>
  </IonPage>
</template>
