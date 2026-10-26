/**
 * The last step of start-up: the photos stored without a size take the size of their picture. `main.ts` starts it
 * once the catalogues are loaded; the Ciel tab waits on `photoSizesRepaired()` and reads its photos again when any
 * were repaired (the other tabs read them each time they are shown).
 */
import { repairPhotoSizes } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';

let settle: (repaired: number) => void = () => undefined;
const repaired = new Promise<number>((resolve) => (settle = resolve));

/** Runs the repair; a failure is reported and counts as nothing repaired. */
export async function repairStoredPhotoSizes(): Promise<void> {
  settle(
    await repairPhotoSizes().catch((error) => {
      reportError('photoSizes.repair', error);
      return 0;
    }),
  );
}

/** The number of photos the start-up repair gave a size to, once it has run. */
export function photoSizesRepaired(): Promise<number> {
  return repaired;
}
