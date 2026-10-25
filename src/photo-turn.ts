import type { QuarterTurns } from '@myastrosky/core/types';

/** The rotation class of each number of quarter turns (none for 0). */
const ROTATIONS = ['', 'rotate-90', 'rotate-180', 'rotate-270'] as const;

/**
 * Shows a picture turned `turns` quarters to the right inside its frame (`photo-turn-frame`): the picture fills the
 * frame, laid on its side (the frame's height as its width) when turned a quarter or three, so that, rotated, it covers
 * or fits the frame as an upright picture does. Its `object-fit` is the caller's.
 */
export function setPictureTurn(img: HTMLElement, turns: QuarterTurns): void {
  img.classList.add('photo-turn-picture');
  img.classList.toggle('photo-turn-picture--upright', turns % 2 === 0);
  img.classList.toggle('photo-turn-picture--sideways', turns % 2 === 1);
  ROTATIONS.forEach((cls, i) => {
    if (cls) img.classList.toggle(cls, i === turns);
  });
}

/** A frame holding `img` shown turned `turns` quarters to the right; the frame takes the picture's place and size. */
export function turnedPictureFrame(
  img: HTMLElement,
  turns: QuarterTurns,
  frameClass: string,
): HTMLElement {
  const frame = document.createElement('div');
  frame.className = `photo-turn-frame ${frameClass}`;
  setPictureTurn(img, turns);
  frame.appendChild(img);
  return frame;
}
