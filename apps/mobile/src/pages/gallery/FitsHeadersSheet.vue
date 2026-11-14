<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { filterFitsCards, type FitsCard } from '@myastrosky/core/fits-header';
import { getPhotoFitsHeaders } from '@myastrosky/app-state/api';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneCardRow from '../../components/PhoneCardRow.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';

// The board "Photo, en-têtes du fichier": the header cards of the file the photo's data was read from, read only, as
// the desktop's "En-têtes" dialog: a filter on the keyword, the value and the comment, then one row per card. The
// cards are read when the sheet opens.
const props = defineProps<{ open: boolean; photoId: string }>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const { showError } = useErrorToast();

const cards = ref<FitsCard[]>([]);
const loading = ref(false);
const query = ref('');
const shown = computed(() => filterFitsCards(cards.value, query.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    query.value = '';
    cards.value = [];
    loading.value = true;
    try {
      cards.value = await getPhotoFitsHeaders(props.photoId);
    } catch (error) {
      void showError(error);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <PhoneSheet
    :open="open"
    :title="t('modal.fitsHeadersTitle')"
    tall
    @update:open="emit('update:open', $event)"
  >
    <template #header-extra>
      <PhoneField
        v-model="query"
        class="mob-form-row--flush"
        type="search"
        :placeholder="t('modal.fitsHeadersFilter')"
        :aria-label="t('modal.fitsHeadersFilter')"
      />
    </template>
    <IonList v-if="shown.length" class="mob-list" lines="none">
      <PhoneCardRow
        v-for="(card, i) in shown"
        :key="i"
        :keyword="card.key"
        :value="card.value"
        :comment="card.comment"
      />
    </IonList>
    <PhoneHelper v-else-if="!loading">{{ t('modal.fitsHeadersEmpty') }}</PhoneHelper>
  </PhoneSheet>
</template>
