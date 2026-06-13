import { createPinia } from 'pinia';

/** Singleton Pinia instance shared across Vue app and non-Vue code (e.g. ui.ts). */
export const pinia = createPinia();
