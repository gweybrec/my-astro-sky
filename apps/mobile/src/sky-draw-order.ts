/**
 * The display order page opened from a photo's sheet on the map (board "Ciel, ordre d'affichage"). The map sets the
 * request before it pushes the page: the photo chosen, the map's photo layer and the photos' outlines on the map as it
 * was on screen (a map hidden behind a pushed page measures nothing, so the page cannot measure the overlaps itself).
 */
import { shallowRef } from 'vue';
import type { PhotoCanvasQuad } from '@myastrosky/core/photo-draw-order';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';

export interface DrawOrderRequest {
  photoId: string;
  layer: PhotoLayer;
  quads: PhotoCanvasQuad[];
}

export const skyDrawOrder = shallowRef<DrawOrderRequest | null>(null);
