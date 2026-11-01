<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { showInfo } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { useRestore, type RestoreSection, type RestoreStep } from '../composables/useRestore';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneRadioGroup from '../components/PhoneRadioGroup.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';

// The boards "Restaurer, photos", "Restaurer, setups" (and "…, option choisie"), "Restaurer, plans" and "Restaurer, le reste": one page per
// step of the restore of the file read on the backup page, "Suivant" at the bottom and the restore on the last step.
// Each step is a page of its own, so the back arrow and the phone's back button go to the step before.
const route = useRoute();
const router = useRouter();
const { showError } = useErrorToast();
const r = useRestore();

// Read once: the pages of the other steps stay mounted under this one, and must keep their own step.
const step = route.params.step as RestoreStep;
const index = computed(() => r.steps.value.indexOf(step));
const last = computed(() => index.value === r.steps.value.length - 1);

/** Opened with no backup read (the app was restarted on this page): the backup page chooses one. */
function leaveIfNothingRead() {
  if (index.value < 0) void router.replace('/settings/backup');
}
onMounted(leaveIfNothingRead);
onIonViewWillEnter(leaveIfNothingRead);

const LISTS: Record<RestoreStep, RestoreSection['list'] | null> = {
  photos: 'images',
  setups: 'setups',
  plans: 'plans',
  other: 'gear',
};
const section = computed(() => {
  const list = LISTS[step];
  return list ? r.section(list) : null;
});

const nextDisabled = computed(() => step === 'setups' && !r.setupsChosen.value);

function next() {
  const following = r.steps.value[index.value + 1];
  if (following) void router.push(`/settings/backup/restore/${following}`);
}

async function restore() {
  // The history position of the backup page: every step page is left at once when the restore is done.
  const depth = index.value + 1;
  try {
    const lines = await r.restore();
    if (!lines) return;
    await showInfo(t('settings.importTitle'), lines.join('\n'));
    if (window.history.state?.back) router.go(-depth);
    else void router.replace('/settings/backup');
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/settings/backup" />
      <div class="restore-heading">
        <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
          {{ t('settings.importTitle') }}
        </h1>
        <span
          v-if="index >= 0"
          class="m-secondary"
          :aria-label="t('mobile.backup.stepAria', { n: index + 1, total: r.steps.value.length })"
          >{{ t('mobile.targets.countOf', { n: index + 1, total: r.steps.value.length }) }}</span
        >
      </div>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="r.preview.value" class="mob-scroll mob-page-fill">
        <IonList v-if="step === 'photos' && r.file.value" class="mob-list" lines="none">
          <PhoneRow :title="r.file.value.name" />
        </IonList>
        <template v-if="step === 'other'">
          <div class="mob-form-row mob-form-row--title">
            <span class="mob-form-label m-secondary">{{ t('settings.importContent') }}</span>
          </div>
          <IonList class="mob-list" lines="none">
            <PhoneCheckRow
              v-if="r.preview.value.hasDsoOverrides"
              v-model="r.sel.importDso"
              :title="t('settings.importDsoOverridesLabel')"
            />
            <PhoneCheckRow
              v-if="r.preview.value.hasPoiCategories"
              v-model="r.sel.importPoiCategories"
              :title="t('settings.importPoiCategoriesLabel')"
            />
            <PhoneCheckRow
              v-if="r.preview.value.hasSkyRegions"
              v-model="r.sel.importSkyRegions"
              :title="t('settings.importSkyRegionsLabel')"
            />
          </IonList>
        </template>
        <template v-if="section">
          <PhoneSectionHeader>{{ section.title }}</PhoneSectionHeader>
          <IonList class="mob-list" lines="none">
            <PhoneCheckRow
              :model-value="r.allTicked(section.list, r.selectableIds(section))"
              :title="t('settings.importSelectAll')"
              @update:model-value="r.toggleAll(section.list, r.selectableIds(section), $event)"
            />
            <template v-for="row in section.rows" :key="row.id">
              <PhoneCheckRow
                :model-value="r.ticked(section, row.id)"
                :title="row.title"
                :subs="row.subs"
                :warn="row.warn"
                :disabled="row.locked"
                @update:model-value="r.toggle(section.list, row.id, $event)"
              />
              <div
                v-if="section.list === 'setups' && r.needsChoice(row.id)"
                class="restore-choices"
              >
                <PhoneRadioGroup
                  :label="row.title"
                  :options="r.setupOptions.value"
                  :model-value="r.setupChoices[row.id]"
                  @update:model-value="r.chooseSetup(row.id, $event)"
                />
                <PhoneField
                  v-if="r.setupChoices[row.id] === 'keepBoth'"
                  v-model="r.setupNames[row.id]"
                  :label="t('settings.importSetupKeptName')"
                />
              </div>
            </template>
          </IonList>
        </template>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton
        v-if="last"
        variant="confirm"
        size="lg"
        block
        :busy="r.importing.value"
        :disabled="!r.importing.value && !r.canRestore.value"
        @click="restore"
      >
        {{ t('settings.importData') }}
      </PhoneButton>
      <PhoneButton
        v-else
        size="lg"
        block
        text-style="strong"
        :disabled="nextDisabled"
        @click="next"
        >{{ t('mobile.backup.next') }}</PhoneButton
      >
    </PhoneFooter>
  </IonPage>
</template>

<style scoped>
/* The title and the step count share their baseline; the pair takes the room the back arrow leaves. */
.restore-heading {
  display: flex;
  flex: 1 1 0;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
}
/* The choices of a setup and the name of its kept copy sit one step in from the setup they belong to. */
.restore-choices {
  padding-inline-start: var(--space-9);
}
</style>
