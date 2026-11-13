/**
 * A shared-sky package dropped on the window: it is kept here while the shared skies window opens, which then reads
 * it. Only a file named `.myastrosky` is taken, so that dropping a photo or a backup keeps doing what it did.
 */
import { SHARE_FILE_EXTENSION } from '@myastrosky/core/domain/shared-sky';

let dropped: File | null = null;

/** Whether a file is a shared-sky package by its name. */
export function isSharedSkyFileName(name: string): boolean {
  return name.toLowerCase().endsWith(SHARE_FILE_EXTENSION);
}

/** The package among the files of a drop, or null. */
export function sharedSkyFileOf(files: Iterable<File> | null | undefined): File | null {
  for (const file of files ?? []) if (isSharedSkyFileName(file.name)) return file;
  return null;
}

/** Keeps a dropped package for the window that is about to open. */
export function holdDroppedSharedSky(file: File): void {
  dropped = file;
}

/** The dropped package, once: null when none is waiting. */
export function takeDroppedSharedSky(): File | null {
  const file = dropped;
  dropped = null;
  return file;
}
