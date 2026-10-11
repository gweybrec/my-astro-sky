<script setup lang="ts">
import { IonReorderGroup, IonItem, IonReorder } from '@ionic/vue';
import type { ItemReorderEventDetail } from '@ionic/vue';
import AppIcon from './AppIcon.vue';
import gripIcon from '../icons/grip.svg?raw';

// A reorderable list (board "Ciel, ordre d'affichage"): each entry is a drag handle and a row. `items` are the
// entries' ids in order; releasing a drag emits the new order. With `openable` a tap on a row (not on its handle)
// emits `open` with the entry's id.
const props = defineProps<{ items: { id: string; handleLabel: string }[]; openable?: boolean }>();
const emit = defineEmits<{ reorder: [ids: string[]]; open: [id: string] }>();

function onReorder(event: CustomEvent<ItemReorderEventDetail>) {
  const ids = event.detail.complete(props.items.map((i) => i.id)) as string[];
  emit('reorder', ids);
}
</script>

<template>
  <IonReorderGroup class="mob-entry-list" :disabled="false" @ion-reorder-end="onReorder">
    <IonItem v-for="item in items" :key="item.id" class="mob-entry" lines="none">
      <div class="mob-entry-line">
        <IonReorder class="mob-drag" :aria-label="item.handleLabel"
          ><AppIcon :svg="gripIcon"
        /></IonReorder>
        <IonItem
          v-if="openable"
          class="mob-row"
          button
          :detail="false"
          lines="none"
          @click="emit('open', item.id)"
        >
          <div class="mob-row-line"><slot :id="item.id" /></div>
        </IonItem>
        <div v-else class="mob-row"><slot :id="item.id" /></div>
      </div>
    </IonItem>
  </IonReorderGroup>
</template>
