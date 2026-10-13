<script setup lang="ts">
// Development builds only (route `/dev/components`, absent from the production build): every shared phone component
// in every state, for the checks against the boards and for later reviews. Its texts are labels for the developer,
// not screen texts, so they do not go through the dictionaries.
import { ref } from 'vue';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from '../components/AppIcon.vue';
import PhoneAddRow from '../components/PhoneAddRow.vue';
import PhoneRemoveChips from '../components/PhoneRemoveChips.vue';
import PhoneTextArea from '../components/PhoneTextArea.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneBadge from '../components/PhoneBadge.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneRadioGroup from '../components/PhoneRadioGroup.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneChip from '../components/PhoneChip.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneInfoButton from '../components/PhoneInfoButton.vue';
import PhoneReorderList from '../components/PhoneReorderList.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import PhoneSliderRow from '../components/PhoneSliderRow.vue';
import PhoneToggleRow from '../components/PhoneToggleRow.vue';
import PhoneTargetRow from '../components/PhoneTargetRow.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import filterIcon from '../icons/filter.svg?raw';
import caretIcon from '../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import eyeIcon from '@icons/eye.svg?raw';
import telescopeIcon from '@icons/telescope.svg?raw';

const search = ref('');
const lat = ref('48.58');
const empty = ref('');
const notes = ref('Seeing moyen');
const typed = ref('');
const removable = ref([
  { label: 'M31' },
  { label: 'Grand champ' },
  { label: 'C/2023 A3', icon: plusIcon, color: 'var(--accent)' },
]);
function addTyped() {
  if (typed.value.trim()) removable.value.push({ label: typed.value.trim() });
  typed.value = '';
}
const switchOn = ref(true);
const switchOff = ref(false);
const tickOn = ref(true);
const radioChoice = ref<string>();
const tickOff = ref(false);
const opacity = ref(0.6);
const sheet = ref(false);
const order = ref(['a', 'b', 'c']);
const pressed = ref(true);
const answer = ref('');
const { confirm } = useConfirm();
const { showError } = useErrorToast();

async function askDelete() {
  const yes = await confirm({
    title: 'Supprimer le plan',
    message: 'Supprimer le plan « Nuit du 2026-10-03 » ?',
    confirmLabel: 'Supprimer le plan',
    destructive: true,
  });
  answer.value = yes ? 'oui' : 'non';
}
function raiseError() {
  void showError(new Error("Impossible de calculer l'horizon à partir des données d'altitude"));
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch v-model="search" placeholder="Rechercher…" label="Recherche" />
      <PhoneIconButton label="Filtres"><AppIcon :svg="filterIcon" /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill" data-testid="gallery">
        <PhoneSectionHeader>Boutons</PhoneSectionHeader>
        <div class="mob-form-row" style="display: flex; gap: var(--space-4); flex-wrap: wrap">
          <PhoneButton>Défaut</PhoneButton>
          <PhoneButton variant="action">Action</PhoneButton>
          <PhoneButton variant="confirm">Valider</PhoneButton>
          <PhoneButton variant="danger">Danger</PhoneButton>
          <PhoneButton variant="dangerFill">Supprimer</PhoneButton>
          <PhoneButton variant="text">Texte</PhoneButton>
          <PhoneButton disabled>Désactivé</PhoneButton>
          <PhoneButton variant="action" disabled>Action off</PhoneButton>
          <PhoneButton variant="confirm" disabled>Valider off</PhoneButton>
        </div>
        <div class="mob-form-row" style="display: flex; gap: var(--space-4)">
          <PhoneButton size="lg">Grand</PhoneButton>
          <PhoneButton variant="action" size="lg"
            ><AppIcon :svg="plusIcon" />Avec icône</PhoneButton
          >
          <PhoneButton variant="action" icon aria-label="Icône"
            ><AppIcon :svg="plusIcon"
          /></PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton block>Pleine largeur</PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton variant="field" block text-style="body">
            <span class="mob-btn-key">Types d'objets</span>
            <span class="mob-btn-value">2 types</span>
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>

        <PhoneSectionHeader>Boutons icône (appui long : le nom)</PhoneSectionHeader>
        <div class="mob-form-row" style="display: flex; gap: var(--space-4)">
          <PhoneIconButton label="Ajouter"><AppIcon :svg="plusIcon" /></PhoneIconButton>
          <PhoneIconButton label="Afficher" :pressed="pressed" @click="pressed = !pressed"
            ><AppIcon :svg="eyeIcon"
          /></PhoneIconButton>
          <PhoneIconButton label="Supprimer" danger><AppIcon :svg="trashIcon" /></PhoneIconButton>
          <PhoneIconButton label="Désactivé" disabled><AppIcon :svg="plusIcon" /></PhoneIconButton>
          <PhoneIconButton float label="Sur la carte"><AppIcon :svg="plusIcon" /></PhoneIconButton>
          <PhoneIconButton float label="Sur la carte, activé" :pressed="true"
            ><AppIcon :svg="eyeIcon"
          /></PhoneIconButton>
          <PhoneIconButton float label="Sur la carte, ouvert" :expanded="true"
            ><AppIcon :svg="plusIcon"
          /></PhoneIconButton>
          <PhoneIconButton float label="Indisponible" unavailable="La raison, à l'appui long"
            ><AppIcon :svg="plusIcon"
          /></PhoneIconButton>
          <PhoneInfoButton
            title="Identifier des supernovae"
            message="Recherche dans le Transient Name Server (TNS) les supernovae découvertes dans le champ de cette photo."
          />
        </div>

        <PhoneSectionHeader>Champs</PhoneSectionHeader>
        <PhoneField v-model="lat" label="Latitude (°N)" inputmode="decimal" />
        <PhoneField v-model="empty" label="Hauteur des yeux au sol" unit="m" placeholder="1.7" />
        <PhoneField v-model="lat" label="Désactivé" disabled />
        <PhoneTextArea v-model="notes" label="Notes" placeholder="Notes, commentaires…" />
        <PhoneRemoveChips :items="removable" @remove="removable.splice($event, 1)" />
        <PhoneAddRow
          v-model="typed"
          placeholder="Ajouter une étiquette…"
          aria-label="Ajouter une étiquette"
          @add="addTyped"
        />

        <PhoneSectionHeader>Lignes</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneRow title="Simple" />
          <PhoneRow title="Valeur et chevron" value="Français" chevron button />
          <PhoneRow
            title="Équipement 1"
            :subs="[
              'Askar FRA400 + ZWO ASI533MC',
              'Focale effective : 400 mm · FOV 1.6° × 1.6° · 1.9″/px',
            ]"
            chevron
            roomy
            button
          />
          <PhoneRow title="Icône" :lead="telescopeIcon" chevron button />
          <PhoneRow title="Supprimer" :lead="trashIcon" danger button />
          <PhoneRow title="Désactivée" :subs="['La raison reste lisible']" disabled chevron />
          <PhoneToggleRow v-model="switchOn" title="Interrupteur activé" />
          <PhoneToggleRow v-model="switchOff" title="Interrupteur désactivé" />
          <PhoneToggleRow :model-value="true" title="Interrupteur bloqué" disabled />
          <PhoneToggleRow
            v-model="switchOn"
            title="Interrupteur avec explication"
            info="Le texte long d'explication."
          />
          <PhoneTargetRow
            title="Nébuleuse de l'Amérique du Nord"
            designation="NGC7000"
            type-label="Nébuleuse en émission"
            constellation="CYG"
            magnitude="Magnitude 4.0"
            rating="★★★★★"
            altitude="86°"
            time="21:38"
          />
          <!-- The variants the alignment check measures: a long name, no badge, a long type next to a long designation. -->
          <PhoneTargetRow
            title="Nébuleuse de la Tête de Cheval et de la Flamme dans la constellation d'Orion"
            designation="Sh2-277 · Barnard 33 · IC 434"
            type-label="Nébuleuse en émission très étendue"
            constellation="ORI"
            magnitude="Magnitude 6.8"
            rating="★★★☆☆"
            altitude="52°"
            time="01:12"
          />
          <PhoneTargetRow
            title="Sans badge"
            designation="M31"
            magnitude="Magnitude 3.4"
            rating="★★★★★"
            altitude="70°"
            time="23:05"
          />
          <PhoneRow
            title="Un nom de ligne très long qui ne tient pas sur une seule ligne de l'écran du téléphone"
            value="Valeur"
            chevron
            button
            wrap
          />
          <PhoneToggleRow
            v-model="switchOn"
            title="Un libellé d'interrupteur très long qui passe sur deux lignes avec son explication"
            info="Le texte long d'explication."
          />
        </IonList>
        <PhoneSliderRow
          v-model="opacity"
          label="Opacité"
          :display="opacity.toFixed(2)"
          :min="0"
          :max="1"
          :step="0.05"
        />
        <PhoneSliderRow
          v-model="opacity"
          label="Un nom de réglage plus long sur sa propre ligne"
          stack
          :display="opacity.toFixed(2)"
          :min="0"
          :max="1"
          :step="0.05"
        />
        <PhoneSliderRow
          v-model="opacity"
          label="Un réglage avec explication"
          info="Le texte long d'explication."
          :display="opacity.toFixed(2)"
          :min="0"
          :max="1"
          :step="0.05"
        />
        <PhoneSliderRow
          v-model="opacity"
          label="Désactivé"
          :min="0"
          :max="1"
          :step="0.05"
          disabled
        />

        <PhoneSectionHeader bar>
          Titre avec info
          <template #trail>
            <PhoneInfoButton title="Titre avec info" message="Le texte long d'explication." />
          </template>
        </PhoneSectionHeader>

        <PhoneSectionHeader>Puces et badges</PhoneSectionHeader>
        <div
          class="mob-form-row"
          style="display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: center"
        >
          <PhoneChip>Normale</PhoneChip>
          <PhoneChip :pressed="true">Choisie</PhoneChip>
          <PhoneBadge kind="type">Galaxie</PhoneBadge>
          <PhoneBadge kind="const">Andromède</PhoneBadge>
        </div>
        <!-- Rows mixing plain text and chips: `apps/mobile/scripts/check-baselines.mjs` checks their baselines. -->
        <div class="mob-sheet-header">
          <div class="mob-meta m-secondary" data-baseline-row>
            <span>NGC7000</span>
            <PhoneBadge kind="type">Nébuleuse en émission</PhoneBadge>
            <PhoneBadge kind="const">CYG</PhoneBadge>
          </div>
        </div>
        <div class="mob-sheet-header">
          <div class="mob-meta m-secondary" data-baseline-row>
            <span>M42</span>
            <PhoneBadge kind="type">Nébuleuse</PhoneBadge>
            <PhoneBadge kind="type">Émission</PhoneBadge>
            <PhoneBadge kind="const">ORI</PhoneBadge>
          </div>
        </div>
        <div class="mob-form-row">
          <div class="mob-meta m-secondary" data-baseline-row>
            <span>Texte</span>
            <PhoneChip>Normale</PhoneChip>
            <PhoneChip :pressed="true">Choisie</PhoneChip>
          </div>
        </div>

        <PhoneSectionHeader>Chargement</PhoneSectionHeader>
        <div class="mob-form-row"><PhoneBusy label="Résolution…" /></div>
        <PhoneBusy page />

        <PhoneSectionHeader>Liste réordonnable</PhoneSectionHeader>
        <PhoneReorderList
          :items="order.map((id) => ({ id, handleLabel: `Déplacer ${id}` }))"
          @reorder="order = $event"
        >
          <template #default="{ id }">
            <span class="mob-row-body"
              ><span class="mob-row-title m-body">Entrée {{ id }}</span></span
            >
          </template>
        </PhoneReorderList>

        <PhoneSectionHeader>Fenêtres</PhoneSectionHeader>
        <div class="mob-form-row" style="display: flex; gap: var(--space-4); flex-wrap: wrap">
          <PhoneButton @click="sheet = true">Feuille</PhoneButton>
          <PhoneButton variant="danger" @click="askDelete">Confirmer</PhoneButton>
          <PhoneButton variant="danger" @click="raiseError">Erreur</PhoneButton>
        </div>
        <p class="mob-helper m-secondary" data-testid="answer">{{ answer }}</p>

        <PhoneSectionHeader>État vide</PhoneSectionHeader>
        <div style="--demo-height: 240px; height: var(--demo-height)">
          <PhoneEmptyState
            text="Aucune photo pour l'instant"
            :button-label="t('batch.modalTitle')"
            :button-icon="plusIcon"
          />
        </div>
        <PhoneSectionHeader>Cases à cocher, faits, aide, retour</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneCheckRow v-model="tickOn" title="Cochée" />
          <PhoneCheckRow
            v-model="tickOff"
            title="Décochée"
            :subs="['4.2 MB']"
            :warn="['Avertissement']"
          />
          <PhoneCheckRow :model-value="true" title="Verrouillée" disabled />
        </IonList>
        <PhoneRadioGroup
          v-model="radioChoice"
          label="Choix"
          :options="[
            { value: 'a', label: 'Première' },
            { value: 'b', label: 'Seconde' },
          ]"
        />
        <PhoneFacts
          :facts="[
            { label: 'Focale', value: '1422 mm' },
            { label: 'Résolution', value: '6248 × 4176 px' },
            { label: 'FOV', value: '57′ × 38′', wide: true },
            { label: 'Lune', value: 'Dernier quartier · 50 %', wide: true, icon: caretIcon },
          ]"
        />
        <PhoneHelper>Ligne d'état</PhoneHelper>
        <PhoneHelper class="mob-status--warn">Ligne d'avertissement</PhoneHelper>
        <div class="mob-form-row"><PhoneBackButton fallback="/tabs/settings" /></div>
      </div>
      <PhoneFab label="Ajouter" />
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg">Annuler</PhoneButton>
      <PhoneButton variant="confirm" size="lg">Valider</PhoneButton>
    </PhoneFooter>
    <PhoneSheet v-model:open="sheet" title="Affichage">
      <PhoneToggleRow v-model="switchOn" title="Afficher les photos" />
      <PhoneSliderRow
        v-model="opacity"
        label="Opacité"
        :display="opacity.toFixed(2)"
        :min="0"
        :max="1"
        :step="0.05"
      />
      <template #footer>
        <PhoneButton size="lg" @click="sheet = false">{{ t('modal.cancel') }}</PhoneButton>
        <PhoneButton variant="confirm" size="lg" @click="sheet = false">{{
          t('modal.validate')
        }}</PhoneButton>
      </template>
    </PhoneSheet>
  </IonPage>
</template>
