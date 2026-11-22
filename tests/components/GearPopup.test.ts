import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const showMetadataEditor = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../src/metadata-editor', () => ({ showMetadataEditor }));
vi.mock('../../src/toast', () => ({ showToast }));

import GearPopup from '../../src/components/panels/GearPopup.vue';
import { useCanvasStore } from '../../src/stores/canvas';
import { t } from '../../src/i18n';

/** The gear popup of a photo on the map: deleting the photo is in its editor, not here. */

const photo = { id: 'p1', originalName: 'M31.jpg', labels: [], integrations: [] };

function fakeOverlay() {
  return {
    getPlacedPhotos: () => [{ photo, opacity: 1 }],
    setPhotoOpacity: vi.fn(),
    startRepositioning: vi.fn(),
    updatePhotoData: vi.fn(),
    hidePhoto: vi.fn(),
    unhidePhoto: vi.fn(),
    removePhoto: vi.fn(),
  };
}

describe('GearPopup', () => {
  let overlay: ReturnType<typeof fakeOverlay>;
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    overlay = fakeOverlay();
    (useCanvasStore().overlay as unknown) = overlay;
  });

  const mountPopup = () =>
    mount(GearPopup, {
      props: { photoId: 'p1', anchorRect: new DOMRect(0, 0, 10, 10) },
      attachTo: document.body,
    });

  it('has no delete button', () => {
    const w = mountPopup();
    const labels = [...document.querySelectorAll('.photo-gear-popup button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual([t('photos.reposition'), t('photos.zOrder'), t('gallery.editMetadata')]);
    w.unmount();
  });

  it('opens the editor with a delete that hides the photo and offers to undo it', () => {
    const w = mountPopup();
    const edit = [...document.querySelectorAll<HTMLButtonElement>('.photo-gear-popup button')].find(
      (b) => b.textContent?.trim() === t('gallery.editMetadata'),
    )!;
    edit.click();
    expect(w.emitted('close')).toHaveLength(1);
    const onDelete = showMetadataEditor.mock.calls[0][4] as () => void;
    onDelete();
    expect(overlay.hidePhoto).toHaveBeenCalledWith('p1');
    const toast = showToast.mock.calls[0][0];
    expect(toast.message).toBe(t('photos.deleted', { name: 'M31.jpg' }));
    toast.onAction();
    expect(overlay.unhidePhoto).toHaveBeenCalledWith('p1');
    toast.onExpire();
    expect(overlay.removePhoto).toHaveBeenCalledWith('p1');
    w.unmount();
  });
});
