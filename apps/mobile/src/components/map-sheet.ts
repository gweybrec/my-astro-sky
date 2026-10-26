import type { InjectionKey } from 'vue';

/** Provided by PhoneMapSheetHost: a PhoneMapSheet is only drawn inside one, so it always slides in and out. */
export const MAP_SHEET_HOST: InjectionKey<true> = Symbol('map-sheet-host');

/** How long a page may stay hidden behind a page transition before a new sheet just appears, in ms. */
const WAIT_SHOWN_MS = 3000;
const OFF = 'translateY(100%)';

const reducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** Ionic's sheet speed (`--sheet-slide-duration`, in s), in ms. */
function durationMs(el: Element): number {
  const s = parseFloat(getComputedStyle(el).getPropertyValue('--sheet-slide-duration'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : 300;
}
/** On screen: laid out (no hidden page or `display: none` around it). */
const shown = (el: HTMLElement) => el.offsetParent !== null;
const canAnimate = (el: HTMLElement) => typeof el.animate === 'function' && !reducedMotion();

/** Slides a map sheet up from below the screen, once it is on screen (its page may still be coming back). */
export function slideSheetIn(el: Element, done: () => void): void {
  const sheet = el as HTMLElement;
  if (!canAnimate(sheet)) return done();
  // Held below the screen until it can be seen, so it never shows in place first.
  sheet.style.transform = OFF;
  const start = performance.now();
  const play = () => {
    if (!shown(sheet) && performance.now() - start < WAIT_SHOWN_MS) {
      requestAnimationFrame(play);
      return;
    }
    sheet.style.transform = '';
    const run = sheet.animate([{ transform: OFF }, { transform: 'none' }], {
      duration: durationMs(sheet),
      easing: 'ease',
    });
    run.onfinish = run.oncancel = () => done();
  };
  requestAnimationFrame(play);
}

/** Slides a map sheet down below the screen (at once when it cannot be seen anyway). */
export function slideSheetOut(el: Element, done: () => void): void {
  const sheet = el as HTMLElement;
  if (!canAnimate(sheet) || !shown(sheet)) return done();
  const run = sheet.animate([{ transform: 'none' }, { transform: OFF }], {
    duration: durationMs(sheet),
    easing: 'ease',
    fill: 'forwards',
  });
  run.onfinish = run.oncancel = () => done();
}
