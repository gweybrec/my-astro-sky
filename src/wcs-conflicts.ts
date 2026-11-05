import { createApp, h } from 'vue';
import type { WcsChange } from '@myastrosky/core/photo-metadata-draft';
import WcsConflictDialog from './components/modals/WcsConflictDialog.vue';

/**
 * Ask which of the values a solved file brings should replace the ones the photo already has. Resolves with the
 * ticked changes, or null when the user cancels (then nothing from the file is taken).
 */
export function showWcsConflicts(conflicts: WcsChange[]): Promise<WcsChange[] | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () =>
        h(WcsConflictDialog, {
          conflicts,
          onApply: (chosen: WcsChange[]) => close(chosen),
          onCancel: () => close(null),
        }),
    });
    function close(value: WcsChange[] | null) {
      app.unmount();
      host.remove();
      resolve(value);
    }
    app.mount(host);
  });
}
