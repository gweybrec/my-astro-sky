<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
</script>

<template>
  <!-- The sky map is a later card: the dark sky background only, no text. -->
  <IonPage>
    <IonContent :scroll-y="false" />
  </IonPage>
</template>
