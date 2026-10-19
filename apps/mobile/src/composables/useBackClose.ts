import { onBeforeUnmount } from 'vue';
import { onIonViewDidEnter, onIonViewWillLeave } from '@ionic/vue';
import { useRouter } from 'vue-router';

type BackRegister = (priority: number, handler: (processNext: () => void) => void) => void;

/** Above Ionic's router and the app's exit handler (1), below its overlays (99): a sheet drawn in the page closes first. */
const INLINE_SHEET_PRIORITY = 50;

/**
 * The Android back button closes a sheet that is part of the page (not an Ionic overlay): while the page is showing and
 * `isOpen()` is true, the press calls `close()`; otherwise it goes on to the next handler (the router, or leaving the app).
 * The page is showing while the address is still the one it was entered at: a tab's page is not told when a page is
 * pushed above the tabs (its container is), so without that check the press closed the hidden sheet behind the page
 * on screen, and the back arrow of that page went back at once where the button did nothing.
 */
export function useBackClose(isOpen: () => boolean, close: () => void) {
  const router = useRouter();
  let enteredAt: string | null = null;
  const showing = () => !router || router.currentRoute.value.path === enteredAt;
  const onBack = (event: Event) => {
    const { register } = (event as CustomEvent<{ register: BackRegister }>).detail;
    register(INLINE_SHEET_PRIORITY, (processNext) => {
      if (showing() && isOpen()) close();
      else processNext();
    });
  };
  const stop = () => document.removeEventListener('ionBackButton', onBack);
  onIonViewDidEnter(() => {
    enteredAt = router?.currentRoute.value.path ?? null;
    document.addEventListener('ionBackButton', onBack);
  });
  onIonViewWillLeave(stop);
  onBeforeUnmount(stop);
}
