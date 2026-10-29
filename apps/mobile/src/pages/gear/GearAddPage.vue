<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { invalidateGearCache, type CustomGearType } from '@myastrosky/core/gear-catalog';
import {
  CUSTOM_GEAR_FIELDS,
  buildCustomGearData,
  initialCustomGearValues,
  missingCustomGearFields,
  type CustomGearField,
} from '@myastrosky/core/gear-custom-fields';
import { createCustomGear } from '@myastrosky/app-state/api';
import { useErrorToast } from '../../composables/useErrorToast';
import AppIcon from '../../components/AppIcon.vue';
import PhoneTopBar from '../../components/PhoneTopBar.vue';
import PhoneBackButton from '../../components/PhoneBackButton.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneColorButton from '../../components/PhoneColorButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneFooter from '../../components/PhoneFooter.vue';
import PhoneInfoButton from '../../components/PhoneInfoButton.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import { KIND_TEXTS, isGearKind } from './gear-kinds';
import { gearAdded } from './gear-added';

// The boards "Équipement, ajouter un télescope / une caméra / un accessoire / un filtre", as the desktop's add window:
// the shared field list, the red asterisk on the required ones, the help behind an "i" where it is not obvious from the
// label. "Enregistrer" waits for the required fields, as on the setup's page; the new item is ticked in its lists.
const route = useRoute();
const router = useRouter();
const { showError } = useErrorToast();

const kind = computed<CustomGearType>(() =>
  isGearKind(route.params.type) ? route.params.type : 'telescope',
);
const fields = computed(() => CUSTOM_GEAR_FIELDS[kind.value]);
const values = ref<Record<string, string>>(initialCustomGearValues(kind.value));
const saving = ref(false);
const choosing = ref<CustomGearField | null>(null);
const choiceOpen = ref(false);

const label = (f: CustomGearField) => t(`targets.gear.fields.${f.name}`);
const help = (f: CustomGearField) => t(`targets.gear.fields.help.${f.name}`);
const optionLabel = (f: CustomGearField) =>
  t(f.options?.find((o) => o.value === values.value[f.key])?.labelKey ?? '');
const canSave = computed(
  () => !saving.value && missingCustomGearFields(kind.value, values.value).length === 0,
);

const choiceOptions = computed(
  () => choosing.value?.options?.map((o) => ({ value: o.value, label: t(o.labelKey) })) ?? [],
);
const choiceValue = computed({
  get: () => (choosing.value ? values.value[choosing.value.key] : ''),
  set: (v: string) => {
    if (choosing.value) values.value[choosing.value.key] = v;
    choiceOpen.value = false;
  },
});

function choose(f: CustomGearField) {
  choosing.value = f;
  choiceOpen.value = true;
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const { id } = await createCustomGear(
      kind.value,
      buildCustomGearData(kind.value, values.value),
    );
    invalidateGearCache(kind.value);
    gearAdded(kind.value, id);
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
      <PhoneBackButton fallback="/settings/setups" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t(KIND_TEXTS[kind].add) }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-pad mob-page-safe">
        <template v-for="f in fields" :key="f.key">
          <div v-if="f.type === 'color'" class="mob-add-row">
            <PhoneColorButton v-model="values[f.key]" :field="label(f)" :label="label(f)" />
            <PhoneInfoButton v-if="f.phoneInfo" :title="label(f)" :message="help(f)" />
          </div>
          <div v-else-if="f.type === 'select'" class="mob-add-row">
            <PhoneButton
              variant="field"
              text-style="body"
              block
              :aria-label="
                t('mobile.format.labelValue', { label: label(f), value: optionLabel(f) })
              "
              @click="choose(f)"
            >
              <span class="mob-btn-key"
                >{{ label(f) }}{{ f.required ? ' ' : ''
                }}<span v-if="f.required" class="mob-required">*</span></span
              >
              <span class="mob-btn-value">{{ optionLabel(f) }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
            <PhoneInfoButton v-if="f.phoneInfo" :title="label(f)" :message="help(f)" />
          </div>
          <template v-else-if="f.phoneInfo">
            <div class="mob-form-row mob-form-row--title mob-form-row--bar">
              <span class="mob-form-label m-secondary"
                >{{ label(f) }}{{ f.required ? ' ' : ''
                }}<span v-if="f.required" class="mob-required">*</span></span
              >
              <PhoneInfoButton :title="label(f)" :message="help(f)" />
            </div>
            <PhoneField
              v-model="values[f.key]"
              :aria-label="label(f)"
              :inputmode="f.type === 'number' ? 'decimal' : undefined"
            />
          </template>
          <PhoneField
            v-else
            v-model="values[f.key]"
            :label="label(f)"
            :required="f.required"
            :inputmode="f.type === 'number' ? 'decimal' : undefined"
          />
        </template>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg" @click="router.back()">{{ t('targets.gear.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!canSave" :busy="saving" @click="save">
        {{ t('targets.gear.save') }}
      </PhoneButton>
    </PhoneFooter>

    <PhoneRadioSheet
      v-model:open="choiceOpen"
      v-model:value="choiceValue"
      :title="choosing ? label(choosing) : ''"
      :options="choiceOptions"
    />
  </IonPage>
</template>
