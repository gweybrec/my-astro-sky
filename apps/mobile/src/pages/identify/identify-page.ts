import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import { isPhotoSolved } from '@myastrosky/core/photo-identify';
import { photoAsShown } from '@myastrosky/core/photo-rotation';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';
import { getPhotos } from '@myastrosky/app-state/api';
import { useErrorToast } from '../../composables/useErrorToast';
import { deliverPois } from '../../identify-session';

/**
 * What the identification pages share: the photo of the address (a photo without a solve has nothing to identify: its
 * page opens instead), leaving the page (Annuler), and adding the points found (Ajouter): they go where
 * `deliverPois` sends them, a toast says which were added (`addedKey`, the desktop's) or that they were already
 * listed, and the page closes. `shown` is the photo as it is shown, turned: what is measured on the picture (a tap, a
 * marker) is in its pixels.
 */
export function useIdentifyPage(onLoaded?: (photo: Photo) => void) {
  const route = useRoute();
  const router = useRouter();
  const { showError, showNotice } = useErrorToast();
  const id = String(route.params.id);
  const photo = ref<Photo | null>(null);
  const adding = ref(false);

  const close = () => {
    if (window.history.state?.back) router.back();
    else void router.replace(`/gallery/photo/${id}`);
  };

  onMounted(async () => {
    try {
      const found = (await getPhotos()).find((p) => p.id === id);
      if (!found || !isPhotoSolved(found)) {
        void router.replace(found ? `/gallery/photo/${id}` : '/tabs/gallery');
        return;
      }
      photo.value = found;
      onLoaded?.(found);
    } catch (error) {
      void showError(error);
    }
  });

  async function add(pois: PointOfInterest[], addedKey: string) {
    if (!photo.value || adding.value) return;
    adding.value = true;
    try {
      const fresh = await deliverPois(photo.value, pois);
      if (fresh.length)
        void showNotice(t(addedKey, { names: fresh.map((p) => p.name).join(', ') }));
      else if (pois.length) void showNotice(t('poi.alreadyListed'));
      close();
    } catch (error) {
      void showError(error);
    } finally {
      adding.value = false;
    }
  }

  const shown = computed(() => (photo.value ? photoAsShown(photo.value) : null));

  return { photo, shown, adding, close, add, showError };
}

/** Toggles one key of a set held in a ref, as a new set (the ticks of a list of results). */
export function toggled<K>(set: Set<K>, key: K, on: boolean): Set<K> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}
