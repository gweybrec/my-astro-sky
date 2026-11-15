<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { AstrometrySubmission } from '@myastrosky/app-state/api';
import {
  SUBMISSIONS_PAGE_SIZE,
  isSubmissionsRateLimited,
  loadSubmissionPage,
} from '@myastrosky/app-state/astrometry-submissions';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useErrorToast } from '../composables/useErrorToast';
import { reusePendingSolution } from '../pending-solve';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import refreshIcon from '../icons/refresh-cw.svg?raw';

// The boards "Importer, réutiliser une solution astrometry.net", "…, astrometry.net refuse" and "…, rien de chargé": the
// submissions of the astrometry.net account, most recent first, five at a time as the desktop's list
// (`loadSubmissionPage`); "Voir les … suivantes" adds the next ones under those shown. A solved submission is tapped to
// place the waiting photo with its solution, and the page goes back to where the photo shows "Résolution". When
// astrometry.net refuses for too many requests, what is shown stays, with the warning toast; with nothing shown, the
// reason takes the place of the list.
const route = useRoute();
const router = useRouter();
const { showError, showWarning } = useErrorToast();

const pendingId = String(route.params.id);
const submissions = shallowRef<AstrometrySubmission[]>([]);
const total = ref(0);
const loading = ref(false);
/** Why nothing is shown (astrometry.net refused, no submission, another error); empty while a list is shown. */
const message = ref('');

const helper = computed(() =>
  total.value === 1
    ? t('mobile.reuse.helperOne')
    : t('mobile.reuse.helperMany', { n: total.value }),
);
const remaining = computed(() =>
  Math.min(SUBMISSIONS_PAGE_SIZE, total.value - submissions.value.length),
);
const moreLabel = computed(() =>
  remaining.value === 1
    ? t('mobile.reuse.moreOne')
    : t('mobile.reuse.moreMany', { n: remaining.value }),
);

const solved = (s: AstrometrySubmission) => s.status === 'success';
const stateOf = (s: AstrometrySubmission) =>
  solved(s)
    ? t('mobile.reuse.solved')
    : s.status === 'failure'
      ? t('mobile.reuse.failed')
      : t('mobile.reuse.running');
const stateClass = (s: AstrometrySubmission) =>
  solved(s)
    ? 'mob-status--success'
    : s.status === 'failure'
      ? 'mob-status--danger'
      : 'mob-status--warn';
const subOf = (s: AstrometrySubmission) =>
  typeof s.width === 'number' && typeof s.height === 'number'
    ? `Job ${s.jobId} · ${s.width} × ${s.height} px`
    : `Job ${s.jobId}`;

/**
 * Loads the page at `offset`: the first one (`replace`, a refresh too) takes the place of the list, a next one is added
 * under it. A refusal keeps what is shown.
 */
async function load(offset: number, replace: boolean, forceRefresh = false) {
  loading.value = true;
  try {
    const { page, rateLimited } = await loadSubmissionPage(offset, forceRefresh);
    if (rateLimited) {
      void showWarning(t('modal.submissionsRateLimitedCached'));
      // A refresh refused: the list on screen is the last one loaded.
      if (forceRefresh && submissions.value.length > 0) return;
    }
    submissions.value = replace ? page.submissions : [...submissions.value, ...page.submissions];
    total.value = page.total;
    message.value = page.total === 0 ? t('modal.noSubmissions') : '';
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (submissions.value.length > 0) {
      if (isSubmissionsRateLimited(error)) void showWarning(reason);
      else void showError(error);
    } else {
      message.value = reason;
    }
    if (!isSubmissionsRateLimited(error)) reportError('ReuseSolutionPage.load', error);
  } finally {
    loading.value = false;
  }
}

function refresh() {
  void load(0, true, true);
}

function more() {
  void load(submissions.value.length, false);
}

// The photo shows "Résolution" while its solution is read; a failure comes back as a red toast.
function choose(s: AstrometrySubmission) {
  if (!solved(s) || !s.jobId) return;
  void reusePendingSolution(pendingId, s.jobId);
  if (window.history.state?.back) router.back();
  else void router.replace('/tabs/gallery');
}

onMounted(() => void load(0, true));
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/gallery" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.gallery.reuseSolution') }}
      </h1>
      <PhoneIconButton :label="t('modal.refreshSubmissions')" :disabled="loading" @click="refresh"
        ><AppIcon :svg="refreshIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <template v-if="submissions.length > 0">
          <PhoneHelper>{{ helper }}</PhoneHelper>
          <IonList class="mob-list" lines="none">
            <PhoneRow
              v-for="s in submissions"
              :key="s.jobId"
              :title="s.filename || `Job ${s.jobId}`"
              :subs="[subOf(s)]"
              :button="solved(s)"
              :disabled="!solved(s)"
              @click="choose(s)"
            >
              <template #trail
                ><span :class="stateClass(s)">{{ stateOf(s) }}</span></template
              >
            </PhoneRow>
          </IonList>
          <div v-if="remaining > 0" class="mob-form-row mob-section-gap">
            <PhoneButton variant="action" size="lg" block :busy="loading" @click="more">{{
              moreLabel
            }}</PhoneButton>
          </div>
        </template>
        <div v-else-if="loading" class="mob-empty"><PhoneBusy page /></div>
        <div v-else-if="message" class="mob-empty">
          <p class="mob-empty-text m-body">{{ message }}</p>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
