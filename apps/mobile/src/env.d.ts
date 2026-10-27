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

/** The app's version, injected at build time from the repository's package.json. */
declare const __APP_VERSION__: string;
/** When the app was built, its author and its licence, injected at build time like the version. */
declare const __APP_BUILD_TIMESTAMP__: string;
declare const __APP_AUTHOR_NAME__: string;
declare const __APP_AUTHOR_EMAIL__: string;
declare const __APP_LICENSE__: string;
