import { onBeforeUnmount, ref, type Ref } from 'vue';

/**
 * Whether the phone is held sideways, as the stylesheet sees it (`(orientation: landscape)`), kept up to date while the
 * component lives: the screens that lay out or behave differently each way read it here.
 */
export function useLandscape(): Ref<boolean> {
  const query =
    typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: landscape)') : null;
  const landscape = ref(query?.matches ?? false);
  const onTurn = () => (landscape.value = query?.matches ?? false);
  query?.addEventListener('change', onTurn);
  onBeforeUnmount(() => query?.removeEventListener('change', onTurn));
  return landscape;
}
