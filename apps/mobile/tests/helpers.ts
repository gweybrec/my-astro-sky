import { defineComponent, h } from 'vue';

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

export const ionicStubs = {
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
