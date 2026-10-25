<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner } from '@ionic/vue';

// The design system's text button (`.mob-btn`) on Ionic's button. Roles follow the desktop: the default is the
// ghost/cancel button, `action` the accent fill, `confirm` the green save/validate button, `danger` the outlined
// inline delete, `dangerFill` the red choice of a dialog, `field` a readout that opens a picker, `text` no border.
const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'action' | 'confirm' | 'danger' | 'dangerFill' | 'field' | 'text';
    size?: 'md' | 'lg';
    block?: boolean;
    /** A 48 px square button that holds only an icon (the magnifier beside a field). */
    icon?: boolean;
    disabled?: boolean;
    /** A toggle that is on (the selected fill; Ionic keeps aria-pressed off the host, so the class carries it). */
    pressed?: boolean;
    /** Waits for a screen that is not built yet: drawn as the board draws it, without a tap. */
    waiting?: boolean;
    /** Its action is running: the spinner before the label, not dimmed, no tap until it ends. */
    busy?: boolean;
    /** Type style of the label: the filled roles are in the strong weight, a field is in the secondary size. */
    textStyle?: 'body' | 'strong' | 'secondary';
  }>(),
  { variant: 'default', size: 'md', textStyle: undefined },
);

const VARIANT_CLASS = {
  default: '',
  action: 'mob-btn--action',
  confirm: 'mob-btn--confirm',
  danger: 'mob-btn--danger',
  dangerFill: 'mob-btn--danger-fill',
  field: 'mob-btn--field',
  text: 'mob-btn--text',
} as const;

const typeClass = computed(() => {
  const style =
    props.textStyle ??
    (props.variant === 'action' || props.variant === 'confirm' || props.variant === 'dangerFill'
      ? 'strong'
      : props.variant === 'field'
        ? 'secondary'
        : 'body');
  return { body: 'm-body', strong: 'm-body-strong', secondary: 'm-secondary' }[style];
});
</script>

<template>
  <IonButton
    fill="clear"
    :disabled="disabled"
    :aria-disabled="waiting || busy ? 'true' : undefined"
    :aria-busy="busy ? 'true' : undefined"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    class="mob-btn"
    :class="[
      VARIANT_CLASS[variant],
      typeClass,
      {
        'mob-btn--pressed': pressed,
        'mob-btn--lg': size === 'lg',
        'mob-btn--block': block,
        'mob-btn--icon': icon,
        'mob-btn--busy': busy,
      },
    ]"
  >
    <span class="mob-btn-content" :class="typeClass"
      ><IonSpinner v-if="busy" name="crescent" class="mob-spinner" aria-hidden="true" /><slot
    /></span>
  </IonButton>
</template>
