/**
 * The last steps of start-up: the photos stored without a size take the size of their picture, then the large photos
 * without a medium-sized copy get one. `main.ts` starts them once the catalogues are loaded; the Ciel tab waits on
 * `photoSizesRepaired()` and `photoMediumsMade()` and reads its photos again when any changed (the other tabs read
 * them each time they are shown).
 */
import { makeMissingPhotoMediums, repairPhotoSizes } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';

let settle: (repaired: number) => void = () => undefined;
const repaired = new Promise<number>((resolve) => (settle = resolve));
let settleMediums: (made: number) => void = () => undefined;
const mediums = new Promise<number>((resolve) => (settleMediums = resolve));

/** Runs the repair, then makes the medium-sized copies; a failure is reported and counts as nothing done. */
export async function repairStoredPhotoSizes(): Promise<void> {
  settle(
    await repairPhotoSizes().catch((error) => {
      reportError('photoSizes.repair', error);
      return 0;
    }),
  );
  settleMediums(
    await makeMissingPhotoMediums().catch((error) => {
      reportError('photoSizes.mediums', error);
      return 0;
    }),
  );
}

/** The number of photos the start-up repair gave a size to, once it has run. */
export function photoSizesRepaired(): Promise<number> {
  return repaired;
}

/** The number of medium-sized copies made at start-up, once they are. */
export function photoMediumsMade(): Promise<number> {
  return mediums;
}
