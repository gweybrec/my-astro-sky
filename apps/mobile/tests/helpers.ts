import { defineComponent, h, inject, provide } from 'vue';

/** Ionic's web components are not defined in happy-dom: each is replaced by a plain element that renders its slot. */
const plain = (tag: string) =>
  defineComponent({
    inheritAttrs: true,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.());
    },
  });

/** A text input: the stub is the native input, so the placeholder, the type and the value can be read. */
const input = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () =>
      h('input', {
        ...attrs,
        value: props.modelValue,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
      });
  },
});

/** A tick box: the stub is a button that reports its new state as Ionic's `ionChange` does. */
const checkbox = defineComponent({
  inheritAttrs: true,
  props: { checked: Boolean, disabled: Boolean },
  emits: ['ionChange'],
  setup(props, { slots, emit }) {
    return () =>
      h(
        'button',
        {
          role: 'checkbox',
          'aria-checked': String(props.checked),
          disabled: props.disabled,
          onClick: () => emit('ionChange', { detail: { checked: !props.checked } }),
        },
        slots.default?.(),
      );
  },
});

/** A radio group: the stub reports the chosen value as Ionic's `ionChange` does. */
const radioGroup = defineComponent({
  inheritAttrs: true,
  props: { value: { type: String, default: undefined } },
  emits: ['ionChange'],
  setup(props, { slots, emit }) {
    provide('stub-radio-group', {
      value: () => props.value,
      choose: (value: string) => emit('ionChange', { detail: { value } }),
    });
    return () => h('div', { role: 'radiogroup' }, slots.default?.());
  },
});

/** A radio: the stub is a button that chooses its value in the enclosing group. */
const radio = defineComponent({
  inheritAttrs: true,
  props: { value: { type: String, default: '' } },
  setup(props, { slots }) {
    const group = inject<{ value: () => string | undefined; choose: (v: string) => void }>(
      'stub-radio-group',
    )!;
    return () =>
      h(
        'button',
        {
          role: 'radio',
          'aria-checked': String(group.value() === props.value),
          onClick: () => group.choose(props.value),
        },
        slots.default?.(),
      );
  },
});

export const ionicStubs = {
  IonRadioGroup: radioGroup,
  IonRadio: radio,
  IonCheckbox: checkbox,
  IonFab: plain('div'),
  IonFabButton: plain('button'),
  IonFooter: plain('footer'),
  IonSelect: plain('div'),
  IonSelectOption: plain('div'),
  IonPage: plain('div'),
  IonHeader: plain('header'),
  IonContent: plain('div'),
  IonTabs: plain('div'),
  IonTabBar: plain('nav'),
  IonTabButton: plain('button'),
  IonRouterOutlet: plain('div'),
  IonButton: plain('button'),
  IonInput: input,
  IonItem: plain('div'),
  IonList: plain('div'),
  IonListHeader: plain('div'),
  IonToggle: plain('div'),
  IonRange: plain('div'),
  IonChip: plain('div'),
  IonBadge: plain('span'),
  IonSpinner: plain('span'),
  IonModal: plain('div'),
  IonReorderGroup: plain('div'),
  IonReorder: plain('div'),
};
