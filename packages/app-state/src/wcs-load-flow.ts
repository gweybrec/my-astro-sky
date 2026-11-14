/**
 * Reading a solved or raw file for a photo, the same on the desktop and the phone (adding a raw file, the import
 * card's or the photo's "Load a WCS file"): read its header, check that it is probably the photo's file, and ask once
 * when something does not match. A file without a plate solution still gives its capture data. The question is asked
 * by the app (`confirm`), which draws its own dialog.
 */
import type { PlateSolveResult } from '@myastrosky/core/types';
import type { PhotoSkyModel } from '@myastrosky/core/photo-sky-model';
import { loadSetupOptics, type SetupOptics } from '@myastrosky/core/gear-catalog';
import { suggestGearSetup, wcsFileWarnings } from '@myastrosky/core/wcs-file-checks';
import { wcsErrorMessage, wcsWarningText } from '@myastrosky/core/wcs-load';
import { t } from '@myastrosky/core/i18n/index';
import { getGearSetups, solveWCS } from './api';

/** What is known of the photo the file is read for. */
export interface WcsReadTarget {
  /** The size of the displayed picture (the file's solution is scaled to it). */
  width: number;
  height: number;
  dsoIds: readonly string[];
  /** The photo's placement, null when it is not placed. */
  skyModel: PhotoSkyModel | null;
  gearSetupId: string | null;
}

/** Lists why the file may not be the photo's and resolves true when the user goes on anyway. */
export type ConfirmWcsWarnings = (filename: string, warnings: string[]) => Promise<boolean>;

export type WcsReadOutcome =
  /** The file was read and the user went on: `solved` false means only its header data is there. */
  | {
      kind: 'read';
      result: PlateSolveResult;
      solved: boolean;
      /** The saved setup the header points to, for a photo without one. */
      suggestedSetup: { id: string; name: string } | null;
    }
  /** Nothing usable in the file: the message says why. */
  | { kind: 'error'; message: string }
  /** The user cancelled on the warnings. */
  | { kind: 'cancelled' };

/** The optics of the saved setups, empty when they cannot be read (the gear checks are then skipped). */
async function savedSetups(): Promise<{ optics: SetupOptics[]; names: Map<string, string> }> {
  try {
    const setups = await getGearSetups();
    if (setups.length === 0) return { optics: [], names: new Map() };
    return {
      optics: await loadSetupOptics(setups),
      names: new Map(setups.map((s) => [s.id, s.name])),
    };
  } catch {
    return { optics: [], names: new Map() };
  }
}

/** Whether a read file placed the photo (a plate solution with at least one reference point). */
export function isSolved(result: PlateSolveResult): boolean {
  return result.success && (result.correspondences?.length ?? 0) >= 1;
}

/**
 * Reads `file` for the photo `target`; `confirm` asks about the warnings. `checks` false skips the comparison with the
 * photo (a raw file added as the photo itself). Throws what `solveWCS` throws (an unreadable file).
 */
export async function readWcsFileForPhoto(
  file: File,
  target: WcsReadTarget,
  confirm: ConfirmWcsWarnings,
  checks = true,
): Promise<WcsReadOutcome> {
  const result = await solveWCS(file, target.width || undefined, target.height || undefined);
  const solved = isSolved(result);
  if (!solved && !result.fitsHeaders?.length) {
    const info = wcsErrorMessage(result, file.name);
    return { kind: 'error', message: t(info.key, info.params) };
  }

  const { optics, names } = await savedSetups();
  const setup = optics.find((o) => o.setupId === target.gearSetupId) ?? null;
  const suggestedId = target.gearSetupId ? null : suggestGearSetup(result.facts, optics);
  const suggestedSetup = suggestedId
    ? { id: suggestedId, name: names.get(suggestedId) ?? '' }
    : null;

  if (checks) {
    const warnings = wcsFileWarnings(result, {
      dsoIds: target.dsoIds,
      skyModel: target.skyModel,
      width: target.width,
      height: target.height,
      setup,
    });
    if (warnings.length > 0) {
      const go = await confirm(file.name, warnings.map(wcsWarningText));
      if (!go) return { kind: 'cancelled' };
    }
  }
  return { kind: 'read', result, solved, suggestedSetup };
}

/** The saved setup the header of a file points to (`suggestGearSetup`), or null. */
export async function suggestedSetupFor(result: PlateSolveResult): Promise<string | null> {
  if (!result.facts) return null;
  return suggestGearSetup(result.facts, (await savedSetups()).optics);
}

/** The line shown when a file without a plate solution only brought its capture data. */
export function noSolutionMessage(filename: string): string {
  return t('modal.wcsNoSolutionLoaded', { filename });
}
