<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  applyAndStoreSingleOverride,
  getDSOById,
  getDSOCatalogBaseValues,
  getUserOverride,
  resetDsoToBaseValues,
} from '@myastrosky/core/catalog/dso-registry';
import { getConstellationInfos } from '@myastrosky/core/catalog/star-registry';
import {
  buildDsoOverride,
  dsoConstellationOptions,
  dsoOverrideForm,
  DSO_EDIT_TYPES,
  type DsoOverrideForm,
} from '@myastrosky/core/catalog/dso-override-form';
import { deleteDsoOverride, upsertDsoOverride } from '@myastrosky/app-state/api';
import { catalogsReady } from '../../catalogs';
import { useErrorToast } from '../../composables/useErrorToast';
import { skySelection } from '../../composables/useSkySelection';
import AppIcon from '../../components/AppIcon.vue';
import PhoneTopBar from '../../components/PhoneTopBar.vue';
import PhoneBackButton from '../../components/PhoneBackButton.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneFooter from '../../components/PhoneFooter.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import resetIcon from '../../icons/rotate-ccw.svg?raw';

// The board "Objet, modifier": the desktop's "Modifier les métadonnées DSO" as a page, opened from the map's object
// sheet. The fields hold the user's corrections; empty, they show the catalogue's value as a hint. "Réinitialiser"
// empties them; "Enregistrer" keeps what differs from the catalogue (nothing left: the correction is removed), applies
// it to the loaded catalogue and goes back to the map, whose sheet shows the object corrected.
const route = useRoute();
const router = useRouter();
const { showError, showNotice } = useErrorToast();

const dsoId = computed(() => String(route.params.id));
const dso = ref(getDSOById(dsoId.value));
// The catalogue is read again once it is loaded: the page may open before it is (an address opened directly).
const base = shallowRef(getDSOCatalogBaseValues(dsoId.value));
const form = ref<DsoOverrideForm>(dsoOverrideForm(getUserOverride(dsoId.value), base.value));
const constellations = ref<{ id: string; name: string }[]>([]);
const saving = ref(false);

onMounted(async () => {
  try {
    await catalogsReady();
    dso.value = getDSOById(dsoId.value);
    base.value = getDSOCatalogBaseValues(dsoId.value);
    form.value = dsoOverrideForm(getUserOverride(dsoId.value), base.value);
    constellations.value = dsoConstellationOptions(getConstellationInfos());
  } catch (error) {
    void showError(error);
  }
});

/** "(défaut)" after the catalogue's choice, as the desktop's lists. */
const marked = (label: string, isBase: boolean) =>
  isBase ? `${label}${t('dso.editConstellationDefaultSuffix')}` : label;
const typeOptions = computed(() =>
  DSO_EDIT_TYPES.map((code) => ({
    value: code as string,
    label: marked(`${code} — ${t(`dso.types.${code}`)}`, code === base.value?.type),
  })),
);
const constellationOptions = computed(() =>
  constellations.value.map((c) => ({
    value: c.id,
    label: marked(`${c.name} (${c.id})`, c.id === base.value?.constellation),
  })),
);
const typePicker = ref(false);
const constellationPicker = ref(false);
const typeLabel = computed(
  () => typeOptions.value.find((o) => o.value === form.value.type)?.label ?? '',
);
const constellationLabel = computed(
  () => constellationOptions.value.find((o) => o.value === form.value.constellation)?.label ?? '',
);

function reset() {
  form.value = dsoOverrideForm(undefined, base.value);
}

async function save() {
  const d = dso.value;
  if (!d || saving.value) return;
  saving.value = true;
  try {
    const override = buildDsoOverride(form.value, d, base.value);
    if (Object.keys(override).length === 0) {
      await deleteDsoOverride(d.id);
      resetDsoToBaseValues(d.id);
    } else {
      await upsertDsoOverride(d.id, override);
      applyAndStoreSingleOverride(d.id, override);
    }
    // The map's sheet and highlight read the object again.
    if (skySelection.value?.kind === 'dso' && skySelection.value.dso.id === d.id) {
      skySelection.value = { kind: 'dso', dso: d };
    }
    void showNotice(t('dso.editSaved'));
    router.back();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/sky" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t('dso.editModalTitle') }}</h1>
      <PhoneIconButton :label="t('dso.editReset')" @click="reset"
        ><AppIcon :svg="resetIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="dso" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <div class="mob-sheet-header" style="padding-top: var(--space-4)">
          <div class="mob-meta m-secondary">
            <span>{{ dso.catalogs[0] ?? dso.id }}</span>
          </div>
        </div>
        <PhoneField
          v-model="form.names.fr"
          :label="t('dso.editNameFr')"
          :placeholder="base?.nameFr ?? ''"
        />
        <PhoneField
          v-model="form.names.en"
          :label="t('dso.editNameEn')"
          :placeholder="base?.nameEn ?? ''"
        />
        <PhoneField
          v-model="form.names.es"
          :label="t('dso.editNameEs')"
          :placeholder="base?.nameEs ?? ''"
        />
        <PhoneField
          v-model="form.names.de"
          :label="t('dso.editNameDe')"
          :placeholder="base?.nameDe ?? ''"
        />
        <PhoneField
          v-model="form.ra"
          :label="t('dso.editRa')"
          inputmode="decimal"
          :placeholder="String(base?.ra ?? dso.ra)"
        />
        <PhoneField
          v-model="form.dec"
          :label="t('dso.editDec')"
          inputmode="decimal"
          :placeholder="String(base?.dec ?? dso.dec)"
        />
        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('dso.editType') }}</label>
          <PhoneButton
            variant="field"
            text-style="body"
            block
            class="mob-btn--wrap"
            :aria-label="`${t('dso.editType')} : ${typeLabel}`"
            @click="typePicker = true"
          >
            <span class="mob-btn-label">{{ typeLabel }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('dso.editConstellation') }}</label>
          <PhoneButton
            variant="field"
            text-style="body"
            block
            class="mob-btn--wrap"
            :aria-label="`${t('dso.editConstellation')} : ${constellationLabel}`"
            @click="constellationPicker = true"
          >
            <span class="mob-btn-label">{{ constellationLabel }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <PhoneField
          v-model="form.rating"
          :label="t('dso.editRating')"
          inputmode="numeric"
          :placeholder="base?.rating != null ? String(base.rating) : ''"
        />
        <PhoneField
          v-model="form.difficulty"
          :label="t('dso.editDifficulty')"
          inputmode="numeric"
          :placeholder="base?.difficulty != null ? String(base.difficulty) : ''"
        />
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg" @click="router.back()">{{ t('modal.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="saving || !dso" @click="save">
        {{ t('dso.save') }}
      </PhoneButton>
    </PhoneFooter>
    <PhoneRadioSheet
      v-model:open="typePicker"
      v-model:value="form.type"
      :title="t('dso.editType')"
      :options="typeOptions"
    />
    <PhoneRadioSheet
      v-model:open="constellationPicker"
      v-model:value="form.constellation"
      :title="t('dso.editConstellation')"
      :options="constellationOptions"
    />
  </IonPage>
</template>
