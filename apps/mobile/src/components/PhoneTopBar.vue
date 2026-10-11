<script setup lang="ts">
import { IonHeader } from '@ionic/vue';
</script>

<template>
  <!-- The design system's top bar (`.mob-topbar`): the title, or the search field and its side button. -->
  <IonHeader class="mob-topbar"><slot /></IonHeader>
</template>
