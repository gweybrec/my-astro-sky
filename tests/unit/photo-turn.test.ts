import { describe, it, expect } from 'vitest';
import { setPictureTurn, turnedPictureFrame } from '../../src/photo-turn';

describe('a picture shown turned in its frame', () => {
  it('lies on its side and is rotated when turned a quarter or three, upright otherwise', () => {
    const img = document.createElement('img');
    setPictureTurn(img, 1);
    expect([...img.classList].sort()).toEqual(
      ['photo-turn-picture', 'photo-turn-picture--sideways', 'rotate-90'].sort(),
    );
    setPictureTurn(img, 2);
    expect([...img.classList].sort()).toEqual(
      ['photo-turn-picture', 'photo-turn-picture--upright', 'rotate-180'].sort(),
    );
    setPictureTurn(img, 3);
    expect(img.classList.contains('photo-turn-picture--sideways')).toBe(true);
    expect(img.classList.contains('rotate-270')).toBe(true);
    expect(img.classList.contains('rotate-180')).toBe(false);
    setPictureTurn(img, 0);
    expect([...img.classList].sort()).toEqual(
      ['photo-turn-picture', 'photo-turn-picture--upright'].sort(),
    );
  });

  it('keeps the classes the picture already has', () => {
    const img = document.createElement('img');
    img.className = 'object-cover';
    setPictureTurn(img, 1);
    expect(img.classList.contains('object-cover')).toBe(true);
  });

  it('puts the picture in a frame that takes the given classes', () => {
    const img = document.createElement('img');
    const frame = turnedPictureFrame(img, 3, 'w-full aspect-[3/2]');
    expect(frame.className).toBe('photo-turn-frame w-full aspect-[3/2]');
    expect(frame.firstElementChild).toBe(img);
    expect(img.classList.contains('rotate-270')).toBe(true);
  });
});
