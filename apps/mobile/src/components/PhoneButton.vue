<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';

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
      },
    ]"
  >
    <span class="mob-btn-content" :class="typeClass"><slot /></span>
  </IonButton>
</template>
