import type { Router } from 'vue-router';
import type { UseIonRouterResult } from '@ionic/vue';

/** The tabs of the app, by their address under `/tabs/`. */
export type Tab = 'sky' | 'gallery' | 'targets' | 'plans' | 'settings';

/**
 * Opens another tab from a page pushed above a tab (`from`). Changing the address straight from a page two levels
 * above the tabs (a plan's target) leaves Ionic showing the page's own tab under the new tab's address; going back to
 * the page's own tab first, then to the other one, shows the right one.
 */
export async function openTab(router: Router, from: Tab, to: Tab): Promise<void> {
  await router.replace(`/tabs/${from}`);
  await router.replace(`/tabs/${to}`);
}

/** The longest the cover of `swapPagesUnseen` waits for its fade to end (the fade is `--page-swap-fade`). */
const SWAP_FADE_MAX_MS = 1000;

/**
 * Runs page changes out of sight: the app's background covers the screen meanwhile (`.mob-page-swap` on the root),
 * then fades away onto the page reached. Without it, pages opened one after another (a tab, then the pages that were
 * above it) each show for a frame.
 */
/** The latest `swapPagesUnseen`: an earlier one ending does not take its cover away. */
let swapRun = 0;

export async function swapPagesUnseen(run: () => Promise<void>): Promise<void> {
  const root = document.documentElement;
  const mine = ++swapRun;
  root.classList.remove('mob-page-swap--out');
  root.classList.add('mob-page-swap');
  try {
    await run();
  } finally {
    // The page reached is drawn under the cover before it fades.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (mine === swapRun) {
      const done = () => {
        clearTimeout(timer);
        root.removeEventListener('transitionend', onEnd);
        if (mine === swapRun) root.classList.remove('mob-page-swap', 'mob-page-swap--out');
      };
      // The cover's own fade, not one of the page's transitions.
      const onEnd = (event: TransitionEvent) => {
        if ((event.target as Element).localName === 'ion-app' && event.pseudoElement === '::after')
          done();
      };
      const timer = setTimeout(done, SWAP_FADE_MAX_MS);
      root.addEventListener('transitionend', onEnd);
      root.classList.add('mob-page-swap--out');
    }
  }
}

/** The longest `openPageStill` waits for Ionic to put the page in place. */
const PAGE_CHANGE_MAX_MS = 1000;

/**
 * Opens a page above the one shown without Ionic's slide, and waits until Ionic has put it in place (its outlet's
 * `ionNavDidChange`), so that pages opened one after another follow each other.
 */
export function openPageStill(ionRouter: UseIonRouterResult, path: string): Promise<void> {
  return new Promise((resolve) => {
    const outlet = document.querySelector('ion-app > ion-router-outlet');
    if (!outlet) {
      ionRouter.navigate(path, 'none', 'push');
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      outlet.removeEventListener('ionNavDidChange', onChange);
      resolve();
    };
    const onChange = (event: Event) => {
      if (event.target === outlet) done();
    };
    const timer = setTimeout(done, PAGE_CHANGE_MAX_MS);
    outlet.addEventListener('ionNavDidChange', onChange);
    ionRouter.navigate(path, 'none', 'push');
  });
}
