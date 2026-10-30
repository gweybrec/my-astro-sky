<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  accessoryLabel,
  cameraLabel,
  getAccessories,
  getCameras,
  getTelescopes,
  telescopeLabel,
  visibleGear,
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
import penIcon from '@icons/pen.svg?raw';
import { KIND_TEXTS, telescopeLine } from './gear/gear-kinds';
import { takeGearAdded } from './gear/gear-added';

// The boards "Équipement, modifier le setup" and "Équipement, choisir un télescope". The route's `id` is a setup's id,
// or `new` for a setup being added (the same page without the plans that use it and without the delete row). The pen
// beside a field opens that gear's list ("Équipement, gérer les …"); the pickers leave out what was unticked there,
// except the setup's current choice.
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
type Kind = 'telescope' | 'camera' | 'accessory';
const picker = ref<Kind | null>(null);
const query = ref('');
/** The gear list opened from this page (its pen, or the picker's add row), until the page shows again. */
const away = ref<Kind | 'filter' | null>(null);

async function loadGear() {
  [telescopes.value, cameras.value, accessories.value] = await Promise.all([
    getTelescopes().then(sortCustomFirst),
    getCameras().then(sortCustomFirst),
    getAccessories().then(sortCustomFirst),
  ]);
}

onMounted(async () => {
  try {
    await catalogsReady();
    await loadGear();
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

// Back from a gear list: a telescope added from the picker becomes the setup's; a choice unticked there is replaced by
// the first one left ticked (no accessory for an accessory), as the desktop's manage window does.
onIonViewWillEnter(async () => {
  const from = away.value;
  if (!from) return;
  away.value = null;
  try {
    await loadGear();
    const added = from === 'telescope' ? takeGearAdded('telescope') : null;
    const c = choice.value;
    if (from === 'telescope') {
      const tel =
        telescopes.value.find((x) => x.id === added) ??
        (visibleGear(telescopes.value, 'telescope').some((x) => x.id === c.telescopeId)
          ? undefined
          : visibleGear(telescopes.value, 'telescope')[0]);
      if (tel) choice.value = chooseTelescope(c, tel, cameras.value);
    } else if (from === 'camera' && c.cameraId && !isSmart.value) {
      const shown = visibleGear(cameras.value, 'camera');
      if (!shown.some((x) => x.id === c.cameraId))
        choice.value = { ...c, cameraId: shown[0]?.id ?? c.cameraId };
    } else if (from === 'accessory' && c.accessoryId) {
      if (!visibleGear(accessories.value, 'accessory').some((x) => x.id === c.accessoryId))
        choice.value = { ...c, accessoryId: null };
    }
  } catch (error) {
    void showError(error);
  }
});

function manage(kind: Kind | 'filter') {
  away.value = kind;
  void router.push(`/settings/gear/${kind}`);
}

function addTelescope() {
  picker.value = null;
  away.value = 'telescope';
  void router.push('/settings/gear/telescope/new');
}

const usedBy = computed(() => (setupId.value ? plansStore.plansUsingSetup(setupId.value) : []));
const telescope = computed(() => telescopes.value.find((x) => x.id === choice.value.telescopeId));
const isSmart = computed(() => Boolean(telescope.value?.is_smart_telescope));
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
        { label: 'FOV', value: `${summary.value.fov} · ${summary.value.scale}` },
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
  const c = choice.value;
  if (picker.value === 'telescope') {
    all = visibleGear(telescopes.value, 'telescope', c.telescopeId).map((x) => ({
      id: x.id,
      title: telescopeLabel(x),
      subs: [telescopeLine(x)],
    }));
  } else if (picker.value === 'camera') {
    all = visibleGear(cameras.value, 'camera', c.cameraId).map((x) => ({
      id: x.id,
      title: cameraLabel(x),
      subs: [],
    }));
  } else if (picker.value === 'accessory') {
    all = visibleGear(accessories.value, 'accessory', c.accessoryId).map((x) => ({
      id: x.id,
      title: accessoryLabel(x),
      subs: [],
    }));
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
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function scrollToPicked(tries = 20) {
  scrollTimer = undefined;
  const tick = document.querySelector('.mob-sheet-modal .mob-sheet-body .mob-status--success');
  if (tick) {
    tick.scrollIntoView({ block: 'center' });
  } else if (tries > 0) {
    scrollTimer = setTimeout(() => scrollToPicked(tries - 1), 50);
  }
}
// The page can close before the sheet's content shows: stop looking for it then.
onBeforeUnmount(() => clearTimeout(scrollTimer));

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
          <div class="mob-field-with-button">
            <PhoneButton
              variant="field"
              text-style="body"
              block
              class="mob-btn--wrap"
              :aria-label="
                t('mobile.format.labelValue', {
                  label: t('targets.gear.telescope'),
                  value: telescope ? telescopeLabel(telescope) : '',
                })
              "
              @click="openPicker('telescope')"
            >
              <span class="mob-btn-label">{{ telescope ? telescopeLabel(telescope) : '' }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
            <PhoneButton
              icon
              :aria-label="t(KIND_TEXTS.telescope.manage)"
              @click="manage('telescope')"
              ><AppIcon :svg="penIcon"
            /></PhoneButton>
          </div>
        </div>

        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('targets.gear.camera') }}</label>
          <div class="mob-field-with-button">
            <PhoneButton
              variant="field"
              text-style="body"
              block
              class="mob-btn--wrap"
              :disabled="isSmart"
              :aria-label="
                t('mobile.format.labelValue', {
                  label: t('targets.gear.camera'),
                  value: camera ? cameraLabel(camera) : '',
                })
              "
              @click="openPicker('camera')"
            >
              <span class="mob-btn-label">{{ camera ? cameraLabel(camera) : '' }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
            <PhoneButton
              v-if="!isSmart"
              icon
              :aria-label="t(KIND_TEXTS.camera.manage)"
              @click="manage('camera')"
              ><AppIcon :svg="penIcon"
            /></PhoneButton>
          </div>
        </div>

        <div class="mob-form-row">
          <label class="mob-form-label m-secondary">{{ t('targets.gear.accessory') }}</label>
          <div class="mob-field-with-button">
            <PhoneButton
              variant="field"
              text-style="body"
              block
              class="mob-btn--wrap"
              :disabled="isSmart"
              :aria-label="
                t('mobile.format.labelValue', {
                  label: t('targets.gear.accessory'),
                  value: accessory ? accessoryLabel(accessory) : '',
                })
              "
              @click="openPicker('accessory')"
            >
              <span class="mob-btn-label">{{ accessory ? accessoryLabel(accessory) : '' }}</span>
              <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
            </PhoneButton>
            <PhoneButton
              v-if="!isSmart"
              icon
              :aria-label="t(KIND_TEXTS.accessory.manage)"
              @click="manage('accessory')"
              ><AppIcon :svg="penIcon"
            /></PhoneButton>
          </div>
        </div>
        <div class="mob-form-row">
          <PhoneButton block @click="manage('filter')">{{
            t('targets.gear.manageFilter')
          }}</PhoneButton>
        </div>

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
      <PhoneRow
        v-if="picker === 'telescope'"
        :title="t('mobile.gear.addTelescope')"
        :lead="plusIcon"
        button
        @click="addTelescope"
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
