/**
 * The desktop's side of reading a solved or raw file for a photo (`@myastrosky/app-state/wcs-load-flow`): the
 * warnings are asked in the desktop's dialog.
 */
import {
  readWcsFileForPhoto as readShared,
  type WcsReadOutcome,
  type WcsReadTarget,
} from '@myastrosky/app-state/wcs-load-flow';
import { confirmWcsWarnings } from './wcs-dialogs';

export {
  noSolutionMessage,
  suggestedSetupFor,
  type WcsReadOutcome,
  type WcsReadTarget,
} from '@myastrosky/app-state/wcs-load-flow';

/**
 * Reads `file` for the photo `target`. `checks` false skips the comparison with the photo (a raw file added as the
 * photo itself). Throws what `solveWCS` throws (an unreadable file).
 */
export function readWcsFileForPhoto(
  file: File,
  target: WcsReadTarget,
  checks = true,
): Promise<WcsReadOutcome> {
  return readShared(file, target, confirmWcsWarnings, checks);
}
