import { defineComponent, h } from 'vue';

/** Ionic's web components are not defined in happy-dom: each is replaced by a plain element that renders its slot. */
const plain = (tag: string) =>
  defineComponent({
    inheritAttrs: true,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.());
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
};
