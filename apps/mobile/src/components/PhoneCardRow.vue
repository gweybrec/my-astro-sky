<script setup lang="ts">
import { IonItem } from '@ionic/vue';

// A row of a file's header (board "Photo, en-têtes du fichier"), read only: the keyword, its value, and the comment
// under the value when the card has one.
defineProps<{ keyword: string; value: string; comment?: string }>();
</script>

<template>
  <IonItem class="mob-row" lines="none" :detail="false">
    <div class="mob-row-line mob-card-row">
      <span class="mob-card-row-key m-mono">{{ keyword }}</span>
      <span class="mob-card-row-value m-mono">{{ value }}</span>
      <span v-if="comment" class="mob-card-row-comment m-caption">{{ comment }}</span>
    </div>
  </IonItem>
</template>
