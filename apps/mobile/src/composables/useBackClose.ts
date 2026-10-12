import { onBeforeUnmount } from 'vue';
import { onIonViewDidEnter, onIonViewWillLeave } from '@ionic/vue';

type BackRegister = (priority: number, handler: (processNext: () => void) => void) => void;

/** Above Ionic's router and the app's exit handler (1), below its overlays (99): a sheet drawn in the page closes first. */
const INLINE_SHEET_PRIORITY = 50;

/**
 * The Android back button closes a sheet that is part of the page (not an Ionic overlay): while the page is showing and
 * `isOpen()` is true, the press calls `close()`; otherwise it goes on to the next handler (the router, or leaving the app).
 */
export function useBackClose(isOpen: () => boolean, close: () => void) {
  const onBack = (event: Event) => {
    const { register } = (event as CustomEvent<{ register: BackRegister }>).detail;
    register(INLINE_SHEET_PRIORITY, (processNext) => {
      if (isOpen()) close();
      else processNext();
    });
  };
  const stop = () => document.removeEventListener('ionBackButton', onBack);
  onIonViewDidEnter(() => document.addEventListener('ionBackButton', onBack));
  onIonViewWillLeave(stop);
  onBeforeUnmount(stop);
}
