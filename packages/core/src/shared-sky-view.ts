/**
 * What the shared-sky screens decide, apart from any screen: the choices of the "skies shown" list, and the text and
 * the button of the confirmation shown before a package is kept. Shared by the desktop and the phone.
 */
import type { SharedSky, SharedSkyPreview, SharedSkyStatus } from './domain/shared-sky';

/** The value of the user's own sky among the skies shown; a visited sky's value is its id (never this short). */
export const MY_SKY = 'mine';

export interface SkyChoiceOption {
  /** `MY_SKY` or a visited sky's id. */
  value: string;
  /** The i18n key of its label (the user's own sky), or the label itself (a visited sky: its sender's name). */
  labelKey?: string;
  label?: string;
}

/** The tick boxes of the "skies shown" list: the user's own sky, then each visited sky under its sender's name. */
export function skyChoiceOptions(skies: readonly SharedSky[]): SkyChoiceOption[] {
  return [
    { value: MY_SKY, labelKey: 'sharedSky.viewMine' },
    ...skies.map((sky) => ({ value: sky.id, label: sky.senderName })),
  ];
}

/**
 * The skies shown, from what was remembered (`{ shown: [...] }`, or the earlier single choice `{ mode, skyId }`), kept
 * to the skies that still exist, in the list's order. Anything unreadable shows the user's own sky alone.
 */
// `unknown`: read back from storage.
export function rememberedSkiesShown(kept: unknown, skies: readonly SharedSky[]): string[] {
  const k = kept as { shown?: unknown; mode?: unknown; skyId?: unknown } | null;
  let values: unknown[] = [MY_SKY];
  if (k && typeof k === 'object') {
    if (Array.isArray(k.shown)) values = k.shown;
    else if (k.mode === 'visit') values = [k.skyId];
    else if (k.mode === 'both') values = [MY_SKY, k.skyId];
  }
  return keepKnownSkies(values, skies);
}

/** `values` kept to the user's own sky and the skies that exist, in the list's order, each once. */
export function keepKnownSkies(values: readonly unknown[], skies: readonly SharedSky[]): string[] {
  const wanted = new Set(values);
  return skyChoiceOptions(skies)
    .map((o) => o.value)
    .filter((v) => wanted.has(v));
}

const PREVIEW_KEYS: Record<SharedSkyStatus, { message: string; confirm: string }> = {
  new: { message: 'sharedSky.previewNew', confirm: 'sharedSky.openConfirm' },
  update: { message: 'sharedSky.previewUpdate', confirm: 'sharedSky.updateConfirm' },
  same: { message: 'sharedSky.previewSame', confirm: 'sharedSky.openConfirm' },
  older: { message: 'sharedSky.previewOlder', confirm: 'sharedSky.olderConfirm' },
};

/** The i18n keys of the confirmation of a package: its message and its button, by how it stands against the visit kept. */
export function sharedSkyPreviewKeys(status: SharedSkyStatus): {
  message: string;
  confirm: string;
} {
  return PREVIEW_KEYS[status];
}

/** Whether the room left is known and too small for the package (its pictures and their thumbnails). */
export function sharedSkyLacksRoom(
  preview: Pick<SharedSkyPreview, 'bytes' | 'freeBytes'>,
): boolean {
  return preview.freeBytes !== null && preview.freeBytes < preview.bytes * 1.05;
}
