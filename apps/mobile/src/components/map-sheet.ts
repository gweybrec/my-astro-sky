import type { InjectionKey, Ref } from 'vue';

/**
 * Provided by PhoneMapSheetHost: whether the map's page is on screen. A PhoneMapSheet is only drawn inside one, which
 * closes it when it goes, and it is open only while its page shows (it would show over another page otherwise).
 */
export const MAP_SHEET_HOST: InjectionKey<Ref<boolean>> = Symbol('map-sheet-host');

/**
 * Provided by a PhoneMapSheet to its content: content still loading what it shows hands the loading over, and the
 * sheet measures where it stops once it is done (it opens then).
 */
export const SHEET_HOLD: InjectionKey<(loading: Promise<unknown>) => void> = Symbol('sheet-hold');

/**
 * Closes a map sheet removed from the page (its `ion-modal`, which Ionic moved to the app's root and Vue keeps until it
 * is closed, named by the room's `data-modal`): Ionic slides it out.
 */
export function slideSheetOut(el: Element, done: () => void): void {
  const id = (el as HTMLElement).dataset.modal;
  const modal = id ? (document.getElementById(id) as HTMLIonModalElement | null) : null;
  if (!modal?.classList.contains('show-modal')) return done();
  void modal.dismiss().finally(done);
}
