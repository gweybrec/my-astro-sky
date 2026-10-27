<script setup lang="ts">
import type { DataCredit } from '@myastrosky/core/data-credits';

// A credit of the data credits page (`.mob-credit`, not a button): the name, the detail, then the link and the licence
// chip on one line (`.mob-credit-links`), the chip itself a link when the licence has one, and a note. The links open
// the phone's browser.
defineProps<{ credit: DataCredit }>();
</script>

<template>
  <div class="mob-credit">
    <span class="mob-row-title mob-row-title--wrap m-body">{{ credit.name }}</span>
    <span class="mob-row-sub mob-row-sub--wrap m-secondary">{{ credit.detail }}</span>
    <span v-if="credit.url || credit.license" class="mob-credit-links m-secondary">
      <a
        v-if="credit.url"
        class="mob-link"
        :href="credit.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ credit.linkText }}</a
      >
      <a
        v-if="credit.license && credit.licenseUrl"
        class="mob-badge mob-link"
        :href="credit.licenseUrl"
        target="_blank"
        rel="noopener noreferrer"
        >{{ credit.license }}</a
      >
      <span v-else-if="credit.license" class="mob-badge">{{ credit.license }}</span>
    </span>
    <span v-if="credit.note" class="mob-row-sub mob-row-sub--wrap m-secondary">{{
      credit.note
    }}</span>
  </div>
</template>
