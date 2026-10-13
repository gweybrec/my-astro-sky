/**
 * The two device features the Réglages screens use, behind one function each, so the screens run unchanged in a
 * phone-sized desktop browser: the observer's position (Capacitor Geolocation on the phone, the browser's
 * geolocation otherwise) and picking a file (the file picker plugin on the phone, a file input otherwise).
 * `isNativePlatform()` of `platform-init.ts` is the only test of which platform this is.
 */
import { Capacitor } from '@capacitor/core';
import { isNativePlatform } from './platform-init';

export interface DevicePosition {
  latitude: number;
  longitude: number;
}

/** The current position (coordinates only). Rejects when permission is refused or no position is available. */
export async function getCurrentPosition(): Promise<DevicePosition> {
  if (isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    // A refusal is an expected answer: ask for the permission first (it resolves with the state), so that the native
    // bridge's console error of a rejected position request never happens.
    const isGranted = (p: { location: string; coarseLocation: string }) =>
      p.location === 'granted' || p.coarseLocation === 'granted';
    let permission = await Geolocation.checkPermissions();
    if (!isGranted(permission)) permission = await Geolocation.requestPermissions();
    if (!isGranted(permission)) throw new Error('Location permission was denied');
    const { coords } = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 15000,
    });
    return { latitude: coords.latitude, longitude: coords.longitude };
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (error) => reject(new Error(error.message)),
    );
  });
}

/** What a picker may offer: MIME types for the phone's picker, extensions for the browser's input. */
export interface FileTypes {
  mimeTypes: string[];
  extensions: string[];
}

/** A backup bundle: a ZIP, or the metadata-only JSON list. */
export const BACKUP_FILE_TYPES: FileTypes = {
  mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/json'],
  extensions: ['.zip', '.json'],
};

/** A horizon file: CSV or the planetarium's polygonal text. */
export const HORIZON_FILE_TYPES: FileTypes = {
  mimeTypes: ['text/csv', 'text/plain', 'text/comma-separated-values', 'application/octet-stream'],
  extensions: ['.csv', '.txt', '.hor', '.horizon'],
};

/** Photos: JPEG, PNG, WebP and the solved astro formats. FITS has no MIME type, so the phone's picker offers every file. */
export const PHOTO_FILE_TYPES: FileTypes = {
  mimeTypes: [],
  extensions: ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.fit', '.fits', '.xisf'],
};

/** Lets the user pick files (one, or several with `multiple`); empty when the picker is cancelled. */
export async function pickFiles(types: FileTypes, multiple = false): Promise<File[]> {
  if (isNativePlatform()) {
    const { FilePicker } = await import('@capawesome/capacitor-file-picker');
    let result;
    try {
      result = await FilePicker.pickFiles({ types: types.mimeTypes, limit: multiple ? 0 : 1 });
    } catch (error) {
      // The plugin rejects when the picker is closed without a choice.
      if (error instanceof Error && /cancel/i.test(error.message)) return [];
      throw error;
    }
    const files: File[] = [];
    for (const picked of result.files) {
      if (picked.blob) {
        files.push(new File([picked.blob], picked.name, { type: picked.mimeType }));
      } else if (picked.path) {
        // The file stays where it is: it is read through the WebView's address of the picked content.
        const blob = await (await fetch(Capacitor.convertFileSrc(picked.path))).blob();
        files.push(new File([blob], picked.name, { type: picked.mimeType }));
      }
    }
    return files;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = types.extensions.join(',');
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Lets the user pick one file; null when the picker is cancelled. */
export async function pickFile(types: FileTypes): Promise<File | null> {
  return (await pickFiles(types))[0] ?? null;
}
