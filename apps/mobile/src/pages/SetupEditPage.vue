<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  accessoryLabel,
  cameraLabel,
  getAccessories,
  getCameras,
  getTelescopes,
  telescopeLabel,
  type AccessoryData,
  type CameraData,
  type TelescopeData,
} from '@myastrosky/core/gear-catalog';
import { sortCustomFirst } from '@myastrosky/core/gear-sort';
import { buildSetupSummary } from '@myastrosky/core/setup-info';
import {
  canSaveSetup,
  chooseTelescope,
  reconcileSetupGear,
  resolveSetupGear,
  type SetupGearChoice,
} from '@myastrosky/core/setup-gear';
import {
  createGearSetup,
  deleteGearSetupAPI,
  getGearSetups,
  updateGearSetup,
  type GearSetupData,
} from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import caretIcon from '../icons/chevron-down.svg?raw';
import checkIcon from '@icons/check.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Équipement, modifier le setup" and "Équipement, choisir un télescope". The route's `id` is a setup's id,
// or `new` for a setup being added (the same page without the plans that use it and without the delete row).
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const plansStore = usePlansStore();

const setupId = computed(() => (route.params.id === 'new' ? null : String(route.params.id)));
const name = ref('');
const choice = ref<SetupGearChoice>({ telescopeId: '', cameraId: null, accessoryId: null });
const enabled = ref(true);
const telescopes = ref<TelescopeData[]>([]);
const cameras = ref<CameraData[]>([]);
const accessories = ref<AccessoryData[]>([]);
const saving = ref(false);
const picker = ref<'telescope' | 'camera' | 'accessory' | null>(null);
const query = ref('');

onMounted(async () => {
  try {
    await catalogsReady();
    [telescopes.value, cameras.value, accessories.value] = await Promise.all([
      getTelescopes().then(sortCustomFirst),
      getCameras().then(sortCustomFirst),
      getAccessories().then(sortCustomFirst),
    ]);
    let existing: GearSetupData | undefined;
    if (setupId.value) {
      existing = (await getGearSetups()).find((s) => s.id === setupId.value);
      await plansStore.ensureLoaded();
    }
    name.value = existing?.name ?? '';
    enabled.value = existing?.enabled ?? true;
    choice.value = reconcileSetupGear(
      {
        telescopeId: existing?.telescopeId ?? '',
        cameraId: existing?.cameraId ?? null,
        accessoryId: existing?.accessoryId ?? null,
      },
      telescopes.value,
      cameras.value,
    );
  } catch (error) {
    void showError(error);
  }
});

const usedBy = computed(() => (setupId.value ? plansStore.plansUsingSetup(setupId.value) : []));
const telescope = computed(() => telescopes.value.find((x) => x.id === choice.value.telescopeId));
const isSmart = computed(() => telescope.value?.is_smart_telescope ?? false);
const resolved = computed(() =>
  resolveSetupGear(choice.value, telescopes.value, cameras.value, accessories.value),
);
const camera = computed(() => resolved.value?.cam);
const accessory = computed(() => resolved.value?.acc ?? null);
const summary = computed(() =>
  resolved.value
    ? buildSetupSummary(resolved.value.tel, resolved.value.cam, resolved.value.acc)
    : null,
);
const facts = computed(() =>
  summary.value
    ? [
        { label: t('targets.gear.effectiveFocalLength'), value: `${summary.value.focalMm} mm` },
        { label: t('targets.gear.info.resolution'), value: summary.value.resolution },
        { label: 'FOV', value: `${summary.value.fov} · ${summary.value.scale}`, wide: true },
      ]
    : [],
);
const canSave = computed(() => !saving.value && canSaveSetup(name.value, choice.value));

// ── The pickers: one sheet, three kinds of gear ──────────────────────────────────────────────────

interface PickerItem {
  id: string;
  title: string;
  subs: string[];
}

const PICKERS = {
  telescope: {
    title: 'targets.gear.telescope',
    placeholder: 'mobile.gear.searchTelescope',
    label: 'mobile.gear.searchTelescopeLabel',
  },
  camera: {
    title: 'targets.gear.camera',
    placeholder: 'mobile.gear.searchCamera',
    label: 'mobile.gear.searchCameraLabel',
  },
  accessory: {
    title: 'targets.gear.accessory',
    placeholder: 'mobile.gear.searchAccessory',
    label: 'mobile.gear.searchAccessoryLabel',
  },
} as const;

const items = computed<PickerItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  let all: PickerItem[] = [];
  if (picker.value === 'telescope') {
    all = telescopes.value.map((x) => ({
      id: x.id,
      title: telescopeLabel(x),
      subs: [
        [
          t('mobile.gear.aperture', { mm: x.aperture_mm }),
          t('mobile.gear.focal', { mm: x.focal_length_mm }),
          `f/${x.f_ratio}`,
        ].join(' · '),
      ],
    }));
  } else if (picker.value === 'camera') {
    all = cameras.value.map((x) => ({ id: x.id, title: cameraLabel(x), subs: [] }));
  } else if (picker.value === 'accessory') {
    all = accessories.value.map((x) => ({ id: x.id, title: accessoryLabel(x), subs: [] }));
  }
  return q ? all.filter((i) => i.title.toLowerCase().includes(q)) : all;
});

const pickedId = computed(() =>
  picker.value === 'telescope'
    ? choice.value.telescopeId
    : picker.value === 'camera'
      ? choice.value.cameraId
      : choice.value.accessoryId,
);

function openPicker(kind: 'telescope' | 'camera' | 'accessory') {
  query.value = '';
  picker.value = kind;
  scrollToPicked();
}

/** The sheet opens with the ticked item in view (board "Équipement, choisir un télescope"); the sheet's content exists a moment after it opens. */
function scrollToPicked(tries = 20) {
  const tick = document.querySelector('.mob-sheet-modal .mob-sheet-body .mob-status--success');
  if (tick) {
    tick.scrollIntoView({ block: 'center' });
  } else if (tries > 0) {
    setTimeout(() => scrollToPicked(tries - 1), 50);
  }
}

function pick(id: string | null) {
  if (picker.value === 'telescope') {
    const tel = telescopes.value.find((x) => x.id === id);
    if (tel) choice.value = chooseTelescope(choice.value, tel, cameras.value);
  } else if (picker.value === 'camera') {
    choice.value = { ...choice.value, cameraId: id };
  } else if (picker.value === 'accessory') {
    choice.value = { ...choice.value, accessoryId: id };
  }
  picker.value = null;
}

// ── Save and delete ───────────────────────────────────────────────────────────────────────────────

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const data = {
      name: name.value.trim(),
      telescopeId: choice.value.telescopeId,
      cameraId: choice.value.cameraId!,
      accessoryId: choice.value.accessoryId,
      enabled: enabled.value,
    };
    if (setupId.value) await updateGearSetup(setupId.value, data);
    else await createGearSetup(data);
    router.back();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!setupId.value || usedBy.value.length > 0) return;
  const yes = await confirm({
    title: t('fovOverlay.deleteSetupTitle'),
    message: t('fovOverlay.deleteSetupConfirm', { name: name.value }),
    confirmLabel: t('fovOverlay.deleteSetupTitle'),
    destructive: true,
  });
  if (!yes) return;
  try {
    await deleteGearSetupAPI(setupId.value);
    router.back();
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/settings/setups" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ setupId ? t('fovOverlay.editModalTitle') : t('fovOverlay.modalTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-pad mob-page-safe">
        <PhoneField v-model="name" :label="t('fovOverlay.setupName')" required />

        <PhoneSectionHeader>{{ t('targets.gear.section') }}</PhoneSectionHeader>
        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('targets.gear.telescope') }}</label>
          <PhoneButton
            variant="field"
            text-style="body"
            block
            class="mob-btn--wrap"
            :aria-label="`${t('targets.gear.telescope')} : ${telescope ? telescopeLabel(telescope) : ''}`"
            @click="openPicker('telescope')"
          >
            <span class="mob-btn-label">{{ telescope ? telescopeLabel(telescope) : '' }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <!-- The pages that manage the gear lists have no board yet: the row shows and does nothing. -->
        <IonList class="mob-list" lines="none">
          <PhoneRow :title="t('targets.gear.manageTelescope')" chevron inert />
        </IonList>

        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('targets.gear.camera') }}</label>
          <PhoneButton
            variant="field"
            text-style="body"
            block
            class="mob-btn--wrap"
            :disabled="isSmart"
            :aria-label="`${t('targets.gear.camera')} : ${camera ? cameraLabel(camera) : ''}`"
            @click="openPicker('camera')"
          >
            <span class="mob-btn-label">{{ camera ? cameraLabel(camera) : '' }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <IonList v-if="!isSmart" class="mob-list" lines="none">
          <PhoneRow :title="t('targets.gear.manageCamera')" chevron inert />
        </IonList>

        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('targets.gear.accessory') }}</label>
          <PhoneButton
            variant="field"
            text-style="body"
            block
            class="mob-btn--wrap"
            :disabled="isSmart"
            :aria-label="`${t('targets.gear.accessory')} : ${accessory ? accessoryLabel(accessory) : ''}`"
            @click="openPicker('accessory')"
          >
            <span class="mob-btn-label">{{ accessory ? accessoryLabel(accessory) : '' }}</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <IonList v-if="!isSmart" class="mob-list" lines="none">
          <PhoneRow :title="t('targets.gear.manageAccessory')" chevron inert />
        </IonList>
        <IonList class="mob-list" lines="none">
          <PhoneRow :title="t('targets.gear.manageFilter')" chevron inert />
        </IonList>

        <PhoneFacts v-if="facts.length" :facts="facts" />

        <template v-if="usedBy.length">
          <PhoneSectionHeader>{{ t('fovOverlay.usedByPlans') }}</PhoneSectionHeader>
          <IonList class="mob-list" lines="none">
            <PhoneRow v-for="plan in usedBy" :key="plan.id" :title="plan.name" />
          </IonList>
        </template>

        <div v-if="setupId" class="mob-section-gap">
          <IonList class="mob-list" lines="none">
            <PhoneRow
              :title="t('fovOverlay.deleteSetupTitle')"
              :subs="usedBy.length ? [t('fovOverlay.deleteSetupDisabledTooltip')] : []"
              :lead="trashIcon"
              danger
              button
              :disabled="usedBy.length > 0"
              @click="remove"
            />
          </IonList>
        </div>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg" @click="router.back()">{{ t('targets.gear.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!canSave" @click="save">
        {{ t('targets.gear.save') }}
      </PhoneButton>
    </PhoneFooter>

    <PhoneSheet
      :open="picker !== null"
      :title="picker ? t(PICKERS[picker].title) : ''"
      tall
      @update:open="picker = null"
    >
      <template #header-extra>
        <PhoneField
          v-if="picker"
          v-model="query"
          class="mob-form-row--flush"
          type="search"
          :placeholder="t(PICKERS[picker].placeholder)"
          :aria-label="t(PICKERS[picker].label)"
        />
      </template>
      <!-- Adding a custom telescope has no board yet: the row shows and does nothing. -->
      <PhoneRow
        v-if="picker === 'telescope'"
        :title="t('mobile.gear.addTelescope')"
        :lead="plusIcon"
        inert
      />
      <PhoneRow
        v-if="picker === 'accessory'"
        :title="t('targets.gear.noAccessory')"
        button
        @click="pick(null)"
      >
        <template v-if="!choice.accessoryId" #trail
          ><span class="mob-status--success"><AppIcon :svg="checkIcon" /></span
        ></template>
      </PhoneRow>
      <PhoneRow
        v-for="item in items"
        :key="item.id"
        :title="item.title"
        :subs="item.subs"
        button
        @click="pick(item.id)"
      >
        <template v-if="item.id === pickedId" #trail
          ><span class="mob-status--success"><AppIcon :svg="checkIcon" /></span
        ></template>
      </PhoneRow>
    </PhoneSheet>
  </IonPage>
</template>
