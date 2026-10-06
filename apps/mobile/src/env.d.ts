/// <reference types="vite/client" />

declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
