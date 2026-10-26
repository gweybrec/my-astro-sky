import type { Router } from 'vue-router';

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
