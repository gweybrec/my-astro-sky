import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import {
  clampZoom,
  DOUBLE_TAP_ZOOM,
  fittedSize,
  MAX_ZOOM,
  usePhotoZoom,
  WHOLE,
  zoomToward,
} from '../src/composables/usePhotoZoom';

/** The zoom of a photo in its viewer. */
describe('the photo zoom', () => {
  it('fits the whole photo inside the viewer, whatever its shape', () => {
    expect(fittedSize({ width: 4000, height: 2000 }, { width: 400, height: 800 })).toEqual({
      width: 400,
      height: 200,
    });
    expect(fittedSize({ width: 1000, height: 4000 }, { width: 400, height: 800 })).toEqual({
      width: 200,
      height: 800,
    });
    expect(fittedSize({ width: 0, height: 0 }, { width: 400, height: 800 })).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('keeps the point under the fingers in place while zooming', () => {
    const point = { x: 120, y: -60 };
    const next = zoomToward({ scale: 2, tx: 30, ty: 10 }, point, 1.5);
    expect(next.scale).toBe(3);
    // The same spot of the photo is under the point before and after.
    expect((point.x - next.tx) / next.scale).toBeCloseTo((point.x - 30) / 2);
    expect((point.y - next.ty) / next.scale).toBeCloseTo((point.y - 10) / 2);
  });

  it('never zooms out past the whole photo nor in past the limit', () => {
    expect(zoomToward(WHOLE, { x: 0, y: 0 }, 0.5).scale).toBe(1);
    expect(zoomToward({ scale: 10, tx: 0, ty: 0 }, { x: 0, y: 0 }, 4).scale).toBe(MAX_ZOOM);
  });

  it('lets a zoomed photo move only as far as it is larger than the viewer', () => {
    const viewer = { width: 400, height: 800 };
    const fitted = { width: 400, height: 200 };
    // Twice as large: 800 x 400, so 200 to each side and nothing up or down.
    expect(clampZoom({ scale: 2, tx: 900, ty: -300 }, fitted, viewer)).toEqual({
      scale: 2,
      tx: 200,
      ty: 0,
    });
    expect(clampZoom({ scale: 1, tx: 50, ty: 50 }, fitted, viewer)).toEqual(WHOLE);
  });

  /** A viewer of 400 x 800 at the screen's corner, holding a 4000 x 2000 photo. */
  function mountViewer() {
    let zoom!: ReturnType<typeof usePhotoZoom>;
    const wrapper = mount(
      defineComponent({
        setup() {
          const viewer = ref<HTMLElement | null>(null);
          zoom = usePhotoZoom(viewer, () => ({ width: 4000, height: 2000 }));
          return () => h('div', { ref: viewer });
        },
      }),
    );
    (wrapper.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800 }) as DOMRect;
    const send = (type: string, id: number, x: number, y: number, at = 0) =>
      (zoom.handlers as Record<string, (e: PointerEvent) => void>)[type]({
        pointerId: id,
        clientX: x,
        clientY: y,
        timeStamp: at,
        currentTarget: wrapper.element,
      } as unknown as PointerEvent);
    const tap = (x: number, y: number, at: number) => {
      send('pointerdown', 1, x, y, at);
      send('pointerup', 1, x, y, at + 50);
    };
    return { zoom, send, tap };
  }

  it('zooms in on a double tap, and shows the photo whole again on the next one', () => {
    const { zoom, tap } = mountViewer();
    tap(200, 400, 0);
    expect(zoom.zoomed.value).toBe(false);
    tap(200, 400, 150);
    expect(zoom.zoomed.value).toBe(true);
    expect(zoom.transform.value).toBe(`translate(0px, 0px) scale(${DOUBLE_TAP_ZOOM})`);
    tap(200, 400, 1000);
    tap(200, 400, 1150);
    expect(zoom.zoomed.value).toBe(false);
  });

  it('does not take two slow taps for a double tap', () => {
    const { zoom, tap } = mountViewer();
    tap(200, 400, 0);
    tap(200, 400, 900);
    expect(zoom.zoomed.value).toBe(false);
  });

  it('zooms with two fingers moving apart, and the reset shows the photo whole', () => {
    const { zoom, send } = mountViewer();
    send('pointerdown', 1, 150, 400);
    send('pointerdown', 2, 250, 400);
    send('pointermove', 1, 100, 400);
    send('pointermove', 2, 300, 400);
    expect(zoom.transform.value).toBe('translate(0px, 0px) scale(2)');
    send('pointerup', 1, 100, 400);
    send('pointerup', 2, 300, 400);
    expect(zoom.zoomed.value).toBe(true);
    zoom.reset();
    expect(zoom.transform.value).toBe('translate(0px, 0px) scale(1)');
  });

  it('moves a zoomed photo with one finger, and leaves a whole photo where it is', () => {
    const { zoom, send, tap } = mountViewer();
    send('pointerdown', 1, 200, 400);
    send('pointermove', 1, 260, 400);
    send('pointerup', 1, 260, 400);
    expect(zoom.transform.value).toBe('translate(0px, 0px) scale(1)');
    tap(200, 400, 2000);
    tap(200, 400, 2100);
    send('pointerdown', 1, 200, 400, 5000);
    send('pointermove', 1, 260, 400, 5010);
    send('pointerup', 1, 260, 400, 5020);
    expect(zoom.transform.value).toBe(`translate(60px, 0px) scale(${DOUBLE_TAP_ZOOM})`);
  });
});
