<template>
  <div class="lang-selector">
    <button
      v-for="l in langs"
      :key="l"
      class="lang-btn"
      :class="{ active: l === currentLang }"
      @click="selectLang(l)"
    >
      {{ l.toUpperCase() }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n';
import type { Lang } from '../../i18n';

const { lang: currentLang, setLang } = useI18n();

const langs: Lang[] = ['fr', 'en', 'es', 'de'];

function selectLang(l: Lang) {
  setLang(l);
}
</script>
