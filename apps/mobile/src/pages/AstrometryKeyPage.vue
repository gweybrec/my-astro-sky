<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  clearAstrometryApiKey,
  loadServerSettings,
  saveServerSettings,
} from '@myastrosky/app-state/api';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneInfoButton from '../components/PhoneInfoButton.vue';

// The board "Réglages, clé astrometry.net": the key of the online solver, as the desktop's solver settings handle it.
// A stored key is never shown: the field is empty with dots as its placeholder, and a line says a key is configured.
// "Enregistrer" stores a typed key and goes back; "Supprimer la clé API" asks first. A stored key that can no
// longer be read gets a line asking to enter it again, and can be deleted.
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const key = ref('');
const keySet = ref(false);
const keyUnreadable = ref(false);
const busy = ref(false);

const placeholder = computed(() =>
  keySet.value ? '••••••••' : t('settings.astrometryApiKeyPlaceholder'),
);
// The desktop's explanation separates its paragraphs with line-break tags; the dialog shows plain text.
const explanation = computed(() =>
  t('settings.astrometryApiKeyTooltip').replace(/(<br\s*\/?>)+/g, '\n\n'),
);

async function load() {
  try {
    const settings = await loadServerSettings();
    keySet.value = settings.apiKeySet;
    keyUnreadable.value = settings.apiKeyUnreadable;
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

function leave() {
  if (window.history.state?.back) router.back();
  else void router.replace('/tabs/settings');
}

async function save() {
  const typed = key.value.trim();
  if (!typed) return;
  busy.value = true;
  try {
    await saveServerSettings({ apiKey: typed });
    key.value = '';
    leave();
  } catch (error) {
    void showError(error);
  } finally {
    busy.value = false;
  }
}

async function clear() {
  const sure = await confirm({
    title: t('settings.clearApiKey'),
    message: t('settings.astrometryApiKey'),
    confirmLabel: t('mobile.plans.delete'),
    destructive: true,
  });
  if (!sure) return;
  try {
    await clearAstrometryApiKey();
    key.value = '';
    keySet.value = false;
    keyUnreadable.value = false;
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.settings.astrometryKey') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill">
        <div class="mob-form-row mob-form-row--title mob-form-row--bar">
          <span class="mob-form-label m-secondary">{{ t('settings.astrometryApiKey') }}</span>
          <PhoneInfoButton :title="t('settings.astrometryApiKey')" :message="explanation" />
        </div>
        <PhoneField
          v-model="key"
          type="password"
          :aria-label="t('settings.astrometryApiKey')"
          :placeholder="placeholder"
        />
        <PhoneHelper v-if="keySet">{{ t('settings.astrometryApiKeySet') }}</PhoneHelper>
        <PhoneHelper v-else-if="keyUnreadable">{{
          t('mobile.settings.keyUnreadable')
        }}</PhoneHelper>
        <div class="mob-form-row">
          <PhoneButton
            variant="danger"
            block
            :disabled="!keySet && !keyUnreadable"
            @click="clear"
            >{{ t('settings.clearApiKey') }}</PhoneButton
          >
        </div>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton
        variant="confirm"
        size="lg"
        block
        :disabled="!key.trim() || busy"
        @click="save"
        >{{ t('settings.saveSettings') }}</PhoneButton
      >
    </PhoneFooter>
  </IonPage>
</template>
