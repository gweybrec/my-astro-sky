<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import type { SharedSky } from '@myastrosky/core/domain/shared-sky';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { useSharedSkyOpen } from '../composables/useSharedSkyOpen';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import trashIcon from '@icons/trash.svg?raw';

// The board "Ciels visités": the desktop's shared skies window. "Partager mon ciel…" opens its page, "Ouvrir un ciel
// partagé…" picks a file and asks (boards "Ouvrir un ciel partagé", "…, mise à jour"), then keeps it with its progress
// and a cancel ("…, import en cours"); the visited skies, under their sender's name (a visit is never renamed here),
// are deleted after a confirmation.
const router = useRouter();
const store = useSharedSkiesStore();
const opening = useSharedSkyOpen();
const { confirm } = useConfirm();
const { showError, showNotice } = useErrorToast();

const load = () => void store.load();
onMounted(load);
onIonViewWillEnter(load);
// Leaving the page while a file is read gives it up; a file being kept goes on.
onUnmounted(() => {
  if (opening.step.value === 'reading') opening.cancel();
});

const dateText = (iso: string) => new Date(iso).toLocaleDateString(getLang());
const skySubs = (sky: SharedSky) => [
  t('sharedSky.sharedOn', { date: dateText(sky.sharedAt) }),
  `${t('sharedSky.photoCount', { count: String(sky.photoCount) })} · ${formatBytes(sky.bytes)}`,
];

// ── Delete ───────────────────────────────────────────────────────────────────────────────────────

async function remove(sky: SharedSky) {
  const yes = await confirm({
    title: t('sharedSky.deleteTitle'),
    message: t('sharedSky.deleteMessage', {
      name: sky.senderName,
      count: String(sky.photoCount),
    }),
    confirmLabel: t('photos.delete'),
    destructive: true,
  });
  if (!yes) return;
  try {
    const freed = await store.remove(sky.id);
    void showNotice(t('sharedSky.deleted', { size: formatBytes(freed) }));
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t('sharedSky.title') }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-section-gap-sm">
        <div class="mob-form-row">
          <PhoneButton
            block
            :disabled="opening.busy.value"
            @click="router.push('/settings/shared-skies/share')"
            >{{ t('sharedSky.shareBtn') }}</PhoneButton
          >
        </div>
        <div class="mob-form-row">
          <PhoneButton block :disabled="opening.busy.value" @click="opening.chooseFile()">{{
            t('sharedSky.openBtn')
          }}</PhoneButton>
        </div>
        <template v-if="opening.progressText.value">
          <PhoneHelper role="status">{{ opening.progressText.value }}</PhoneHelper>
          <div class="mob-form-row">
            <PhoneButton block @click="opening.cancel()">{{ t('modal.cancel') }}</PhoneButton>
          </div>
        </template>

        <PhoneSectionHeader>{{ t('sharedSky.visitedTitle') }}</PhoneSectionHeader>
        <PhoneHelper v-if="store.skies.length === 0">{{ t('sharedSky.noVisits') }}</PhoneHelper>
        <IonList v-else class="mob-list" lines="none">
          <PhoneRow
            v-for="sky in store.skies"
            :key="sky.id"
            :title="sky.senderName"
            :subs="skySubs(sky)"
          >
            <template #trail>
              <PhoneIconButton
                danger
                :label="t('mobile.sharedSky.deleteSky', { name: sky.senderName })"
                :disabled="opening.busy.value"
                @click="remove(sky)"
                ><AppIcon :svg="trashIcon"
              /></PhoneIconButton>
            </template>
          </PhoneRow>
        </IonList>
      </div>
    </IonContent>
  </IonPage>
</template>
