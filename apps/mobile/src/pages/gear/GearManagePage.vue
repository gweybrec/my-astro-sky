<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  getHiddenGearIds,
  invalidateGearCache,
  setHiddenGearIds,
  type CustomGearType,
} from '@myastrosky/core/gear-catalog';
import { deleteCustomGear } from '@myastrosky/app-state/api';
import { catalogsReady } from '../../catalogs';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import AppIcon from '../../components/AppIcon.vue';
import PhoneTopBar from '../../components/PhoneTopBar.vue';
import PhoneBackButton from '../../components/PhoneBackButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import { KIND_TEXTS, isGearKind, loadGearItems, needsOne, type GearItem } from './gear-kinds';

// The boards "Équipement, gérer les télescopes / caméras / accessoires / filtres", as the desktop's manage window: every
// item with a tick box (unticked = hidden from the setup's pickers, or from the filter lists), the count of the ticked
// ones, the add row, and a bin on the user's own items. A tick is kept at once. A telescope or a camera keeps at least
// one ticked: with none, the count says so in red and the last selection with one stays stored.
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const kind = computed<CustomGearType>(() =>
  isGearKind(route.params.type) ? route.params.type : 'telescope',
);
const texts = computed(() => KIND_TEXTS[kind.value]);
const items = ref<GearItem[]>([]);
const hidden = ref(new Set<string>());
const query = ref('');

async function load() {
  try {
    await catalogsReady();
    items.value = await loadGearItems(kind.value);
    hidden.value = getHiddenGearIds(kind.value);
  } catch (error) {
    void showError(error);
  }
}
onIonViewWillEnter(() => void load());

const listed = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? items.value.filter((i) => i.title.toLowerCase().includes(q)) : items.value;
});
const selected = computed(() => items.value.filter((i) => !hidden.value.has(i.id)).length);
const noneLeft = computed(() => needsOne(kind.value) && selected.value === 0);
const count = computed(() => {
  const base = t(texts.value.count, {
    selected: String(selected.value),
    total: String(items.value.length),
  });
  return noneLeft.value ? `${base}. ${t('targets.gear.atLeastOneRequired')}` : base;
});

function tick(id: string, on: boolean) {
  const next = new Set(hidden.value);
  if (on) next.delete(id);
  else next.add(id);
  hidden.value = next;
  if (!noneLeft.value) setHiddenGearIds(kind.value, next);
}

async function remove(item: GearItem) {
  const yes = await confirm({
    title: t('mobile.gear.deleteItemTitle', { name: item.title }),
    message: t('settings.deleteConfirmPermanent'),
    confirmLabel: t('photos.delete'),
    destructive: true,
  });
  if (!yes) return;
  try {
    await deleteCustomGear(item.id);
    invalidateGearCache(kind.value);
    const next = new Set(hidden.value);
    next.delete(item.id);
    setHiddenGearIds(kind.value, next);
    await load();
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/settings/setups" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t(texts.manageTitle) }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-page-column mob-page-pad mob-page-stack">
        <PhoneField
          v-model="query"
          type="search"
          :placeholder="t(texts.search)"
          :aria-label="t(texts.searchLabel)"
        />
        <div class="mob-scroll mob-page-safe">
          <PhoneHelper class="mob-helper--flush" :class="{ 'mob-status--danger': noneLeft }">{{
            count
          }}</PhoneHelper>
          <IonList class="mob-list" lines="none">
            <PhoneRow
              :title="t(texts.add)"
              :lead="plusIcon"
              button
              @click="router.push(`/settings/gear/${kind}/new`)"
            />
            <PhoneCheckRow
              v-for="item in listed"
              :key="item.id"
              :model-value="!hidden.has(item.id)"
              :title="item.title"
              :subs="item.subs"
              :swatch="item.swatch"
              @update:model-value="tick(item.id, $event)"
            >
              <template v-if="item.custom" #trail>
                <PhoneIconButton
                  danger
                  :label="t('mobile.gear.deleteItem', { name: item.title })"
                  @click="remove(item)"
                  ><AppIcon :svg="trashIcon"
                /></PhoneIconButton>
              </template>
            </PhoneCheckRow>
          </IonList>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
