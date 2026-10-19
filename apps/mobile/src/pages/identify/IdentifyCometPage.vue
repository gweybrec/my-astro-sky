<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { resolveCategory } from '@myastrosky/core/poi';
import { cometPois, cometsInPhoto } from '@myastrosky/core/photo-identify';
import {
  COMET_CATEGORY_ID,
  jplLookupUrl,
  type CometSearchResult,
  type PlacedComet,
} from '@myastrosky/core/comet-identify';
import { cometElementsAPI } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneCheckLeadRow from '../../components/PhoneCheckLeadRow.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneUtcDateTime from '../../components/PhoneUtcDateTime.vue';
import type { PhotoPoint } from '../../components/PhonePhotoStage.vue';
import IdentifyFrame from './IdentifyFrame.vue';
import IdentifySearching from './IdentifySearching.vue';
import { toggled, useIdentifyPage } from './identify-page';
import searchIcon from '../../icons/search.svg?raw';
import pinIcon from '@icons/supernova-pin.svg?raw';

// The board "Identifier des comètes", as the desktop's CometIdentifyModal: the Minor Planet Center's comet orbits are
// carried to the photo's observation time (UTC); the comets inside the photo are pinned and ticked, the ones just
// outside are listed under "Près de ce champ". A tap on a comet's text makes it the one a tap on the photo moves: its
// pin goes onto the nucleus actually seen when the prediction is a few arcminutes off ("Ajusté"; "Revenir à la position
// prédite" undoes it). It searches as the page opens when the photo has a date.
const categories = usePoiCategoriesStore();
void categories.ensureLoaded();
const pinColor = computed(() => resolveCategory(COMET_CATEGORY_ID, categories.categories).color);

const obsIso = ref('');
const { photo, adding, close, add } = useIdentifyPage((p) => {
  obsIso.value = p.observationDate ?? '';
  if (obsIso.value) void search();
});

const searching = ref(false);
const error = ref('');
const results = ref<CometSearchResult | null>(null);
const selected = ref(new Set<string>());
/** The comet whose pin a tap on the photo moves. */
const activeName = ref<string | null>(null);
/** Pixels the user put a comet's pin on, by name: they win over the prediction. */
const moved = ref(new Map<string, PhotoPoint>());

async function search() {
  if (!photo.value || !obsIso.value || searching.value) return;
  const obs = obsIso.value;
  searching.value = true;
  error.value = '';
  try {
    results.value = cometsInPhoto(photo.value, await cometElementsAPI(), obs);
    // The comets in the photo are ticked; the brightest one is the one a tap moves.
    const names = results.value.inFrame.map((c) => c.name);
    selected.value = new Set(names);
    if (!activeName.value || !names.includes(activeName.value)) activeName.value = names[0] ?? null;
  } catch (err) {
    results.value = null;
    error.value = t('comet.loadError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

function onTap(p: PhotoPoint) {
  const name = activeName.value;
  if (!name) return;
  moved.value = new Map(moved.value).set(name, p);
  selected.value = toggled(selected.value, name, true);
}

function reset(name: string) {
  const next = new Map(moved.value);
  next.delete(name);
  moved.value = next;
}

const pinAt = (c: PlacedComet): PhotoPoint => moved.value.get(c.name) ?? c;
const subLine = (c: PlacedComet) =>
  `${t('comet.colMag')} ${c.mag?.toFixed(1) ?? '—'} · ${t('comet.rate', { n: c.rateArcminPerHour.toFixed(1) })}`;
const nearLine = (c: CometSearchResult['nearby'][number]) =>
  `${t('comet.awayDeg', { n: c.separationDeg.toFixed(1) })} · ${t('comet.colMag')} ${c.mag?.toFixed(1) ?? '—'}`;

function addSelected() {
  if (!results.value || !photo.value) return;
  const chosen = results.value.inFrame.filter((c) => selected.value.has(c.name));
  void add(cometPois(photo.value, chosen, moved.value), 'comet.added');
}
</script>

<template>
  <IdentifyFrame
    :title="t('comet.title')"
    :info="t('comet.intro')"
    :photo="photo"
    results
    :panel-label="t('mobile.identify.cometsFound')"
    @tap="onTap"
  >
    <template #markers="{ onScreen }">
      <div
        v-for="c in results?.inFrame ?? []"
        :key="c.name"
        class="mob-identify-anchor"
        :style="{ left: `${onScreen(pinAt(c)).x}px`, top: `${onScreen(pinAt(c)).y}px` }"
      >
        <span
          class="mob-pin"
          :class="{ 'mob-pin--off': !selected.has(c.name) }"
          :style="{ '--poi-color': pinColor }"
          aria-hidden="true"
          ><AppIcon :svg="pinIcon"
        /></span>
      </div>
    </template>

    <div class="mob-form-row mob-form-row--search">
      <PhoneUtcDateTime v-model="obsIso" :label="t('identify.obsDateLabel')" />
      <span class="mob-unit m-body">UTC</span>
      <PhoneButton
        variant="action"
        icon
        :aria-label="t('identify.search')"
        :disabled="!obsIso || searching"
        @click="search"
        ><AppIcon :svg="searchIcon"
      /></PhoneButton>
    </div>
    <PhoneHelper v-if="!obsIso" class="mob-status--warn">{{
      t('identify.dateRequired')
    }}</PhoneHelper>
    <PhoneHelper v-else-if="error" class="mob-status--danger">{{ error }}</PhoneHelper>
    <IdentifySearching v-else-if="searching" />
    <PhoneHelper v-else-if="results && results.inFrame.length === 0">{{
      t('comet.noCandidates')
    }}</PhoneHelper>
    <PhoneHelper v-else-if="results && activeName">{{
      t('mobile.identify.tapToAdjust', { name: activeName })
    }}</PhoneHelper>
    <div
      v-if="results && (results.inFrame.length || results.nearby.length)"
      class="mob-scroll mob-results-list"
    >
      <div v-if="results.inFrame.length">
        <PhoneCheckLeadRow
          v-for="c in results.inFrame"
          :key="c.name"
          :model-value="selected.has(c.name)"
          :title="c.name"
          :subs="[subLine(c)]"
          :check-label="t('mobile.identify.keepAsPoi', { name: c.name })"
          :current="activeName === c.name"
          button
          @update:model-value="selected = toggled(selected, c.name, $event)"
          @open="activeName = c.name"
        >
          <!-- The badge and "Revenir à la position prédite" keep their room while hidden: the first tap on the photo
               must not grow the panel, which would shrink the photo under the finger. -->
          <template #badges>
            <span
              class="mob-badge mob-badge--type m-caption"
              :class="{ 'mob-invisible': !moved.has(c.name) }"
              >{{ t('comet.adjusted') }}</span
            >
          </template>
          <template #actions>
            <PhoneButton
              variant="text"
              :href="jplLookupUrl(c.designation)"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('comet.viewOnJpl') }}</PhoneButton
            >
            <PhoneButton
              variant="text"
              :class="{ 'mob-invisible': !moved.has(c.name) }"
              :aria-hidden="moved.has(c.name) ? undefined : 'true'"
              @click="reset(c.name)"
              >{{ t('comet.resetPosition') }}</PhoneButton
            >
          </template>
        </PhoneCheckLeadRow>
      </div>
      <!-- Comets just outside the frame: usually a sign that the date or the time is off. Not addable. -->
      <template v-if="results.nearby.length">
        <PhoneSectionHeader>{{ t('comet.nearbyTitle') }}</PhoneSectionHeader>
        <PhoneHelper>{{ t('comet.nearbyHint') }}</PhoneHelper>
        <div>
          <PhoneRow
            v-for="c in results.nearby"
            :key="c.name"
            :title="c.name"
            :subs="[nearLine(c)]"
          />
        </div>
      </template>
    </div>

    <template #footer>
      <div class="mob-sheet-footer mob-sheet-footer--primary-wide">
        <PhoneButton size="lg" @click="close">{{ t('modal.cancel') }}</PhoneButton>
        <PhoneButton
          variant="confirm"
          size="lg"
          :disabled="selected.size === 0 || !results || adding"
          @click="addSelected"
          >{{ t('identify.addSelected', { n: results ? selected.size : 0 }) }}</PhoneButton
        >
      </div>
    </template>
  </IdentifyFrame>
</template>
