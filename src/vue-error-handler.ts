import type { App } from 'vue';
import { reportUnknownRendererError } from './error-reporter';

/** Logs an error thrown in a component of `app` (render, watcher, lifecycle hook, event handler). */
export function installVueErrorHandler(app: App, name: string): void {
  app.config.errorHandler = (err, instance, info) => {
    reportUnknownRendererError('vue_component_error', err, {
      app: name,
      info,
      component: (instance as { $options?: { name?: string } } | null)?.$options?.name ?? 'unknown',
    });
  };
}
