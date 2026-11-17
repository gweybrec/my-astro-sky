import { promises as fsp } from 'fs';

/**
 * Puts the uploaded file at `dest`, in a solver's temporary folder: moved, so that a large stack is neither read
 * into memory nor written twice; copied when the two folders are on different disks (the upload folder is beside
 * the photos, the temporary folder is the system's). The route removes the upload when the solve ends either way.
 */
export async function placeSolverInput(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fsp.copyFile(src, dest);
  }
}
