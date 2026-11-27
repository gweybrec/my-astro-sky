import { installVueErrorHandler } from './vue-error-handler';
import { createApp, h } from 'vue';
import type { FitsCard } from '@myastrosky/core/fits-header';
import WcsWarningsDialog from './components/modals/WcsWarningsDialog.vue';
import FitsHeadersDialog from './components/modals/FitsHeadersDialog.vue';

/** Mounts a dialog on the page and resolves with what its `done` callback gives, once it is closed. */
function mountDialog<T>(render: (done: (value: T) => void) => ReturnType<typeof h>): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({ render: () => render(close) });
    installVueErrorHandler(app, 'wcs-dialog');
    function close(value: T) {
      app.unmount();
      host.remove();
      resolve(value);
    }
    app.mount(host);
  });
}

/**
 * Lists why a solved/raw file may not be this photo's and asks whether to go on. Resolves true for "Continue anyway",
 * false when the user cancels.
 */
export function confirmWcsWarnings(filename: string, warnings: string[]): Promise<boolean> {
  return mountDialog<boolean>((done) =>
    h(WcsWarningsDialog, {
      filename,
      warnings,
      onContinue: () => done(true),
      onCancel: () => done(false),
    }),
  );
}

/** Shows the raw header cards of a file: the ones given, or those `cards` loads. Resolves once it is closed. */
export function showFitsHeaders(cards: FitsCard[] | (() => Promise<FitsCard[]>)): Promise<void> {
  return mountDialog<void>((done) => h(FitsHeadersDialog, { cards, onClose: () => done() }));
}
