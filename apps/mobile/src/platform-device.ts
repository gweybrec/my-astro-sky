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

/** Lets the user pick one file; null when the picker is cancelled. */
export async function pickFile(types: FileTypes): Promise<File | null> {
  if (isNativePlatform()) {
    const { FilePicker } = await import('@capawesome/capacitor-file-picker');
    let result;
    try {
      result = await FilePicker.pickFiles({ types: types.mimeTypes, limit: 1 });
    } catch (error) {
      // The plugin rejects when the picker is closed without a choice.
      if (error instanceof Error && /cancel/i.test(error.message)) return null;
      throw error;
    }
    const picked = result.files[0];
    if (!picked) return null;
    if (picked.blob) return new File([picked.blob], picked.name, { type: picked.mimeType });
    if (!picked.path) return null;
    // The file stays where it is: it is read through the WebView's address of the picked content.
    const blob = await (await fetch(Capacitor.convertFileSrc(picked.path))).blob();
    return new File([blob], picked.name, { type: picked.mimeType });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = types.extensions.join(',');
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
