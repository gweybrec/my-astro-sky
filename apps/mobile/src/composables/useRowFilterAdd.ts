import { onIonViewWillEnter } from '@ionic/vue';
import { useRouter } from 'vue-router';
import { filterLabel, getFilters } from '@myastrosky/core/gear-catalog';
import type { PhotoIntegration } from '@myastrosky/core/types';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { takeGearAdded } from '../pages/gear/gear-added';
import { noteFilterUse } from '../filter-usage';

/**
 * "Ajouter un filtre" from an exposure row's list of filters (board "Photo, modifier les infos, filtre"): opens the
 * filter's add page, and when the page is back, the filter saved there becomes that row's filter. Called in the setup
 * of the page that holds the form (Ionic's page events reach only the page).
 */
export function useRowFilterAdd(rows: () => PhotoIntegration[]) {
  const router = useRouter();
  let waiting: number | null = null;

  onIonViewWillEnter(() => {
    const index = waiting;
    waiting = null;
    if (index === null) return;
    const id = takeGearAdded('filter');
    if (!id) return;
    void (async () => {
      try {
        const added = (await getFilters()).find((f) => f.id === id);
        const row = rows()[index];
        if (added && row) {
          row.filter = filterLabel(added);
          noteFilterUse(row.filter);
        }
      } catch (error) {
        reportError('useRowFilterAdd', error);
      }
    })();
  });

  return (index: number) => {
    waiting = index;
    void router.push('/settings/gear/filter/new');
  };
}
