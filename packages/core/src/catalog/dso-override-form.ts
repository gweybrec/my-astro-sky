import { t } from '../i18n/index';
import type { ConstellationInfo, DSOType, DSOUserOverride } from '../types';

/** The catalogue's constellation and type of an object (`getDSOCatalogBaseValues`); null when it has none. */
export interface DsoCatalogChoice {
  constellation?: string | null;
  type?: string | null;
}

/** The types a deep-sky object can be given in its editor, in the editor's order. */
export const DSO_EDIT_TYPES: DSOType[] = [
  'Gx',
  'GxS',
  'GxE',
  'GxI',
  'OC',
  'GC',
  'EN',
  'RN',
  'PN',
  'SNR',
  'DN',
  'PS',
  '?',
];

/**
 * Returns true when a dropdown selection should be persisted as an override.
 * Empty selection or a value matching the catalog base is treated as "no change",
 * which causes any previous override for that field to be removed on save.
 */
export function shouldOverrideConstellation(
  selected: string,
  baseConstellation: string | null | undefined,
): boolean {
  return !!selected && selected !== (baseConstellation ?? '');
}

export function shouldOverrideType(selected: string, baseType: string | null | undefined): boolean {
  return !!selected && selected !== (baseType ?? '');
}

/** What the object editor's fields hold, as typed: empty means the catalogue's value. */
export interface DsoOverrideForm {
  names: { fr: string; en: string; es: string; de: string };
  ra: string;
  dec: string;
  constellation: string;
  rating: string;
  difficulty: string;
  type: string;
}

/**
 * The editor's fields for an object: the user's override where there is one, the catalogue's type and constellation.
 * Without an override (`undefined`) they are the fields "Réinitialiser" leaves.
 */
export function dsoOverrideForm(
  override: DSOUserOverride | undefined,
  base: DsoCatalogChoice | null,
): DsoOverrideForm {
  const text = (v: number | undefined) => (v !== undefined ? String(v) : '');
  return {
    names: {
      fr: override?.names?.fr ?? '',
      en: override?.names?.en ?? '',
      es: override?.names?.es ?? '',
      de: override?.names?.de ?? '',
    },
    ra: text(override?.ra),
    dec: text(override?.dec),
    constellation: override?.constellation ?? base?.constellation ?? '',
    rating: text(override?.rating),
    difficulty: text(override?.difficulty),
    type: override?.type ?? base?.type ?? '',
  };
}

/**
 * The override the editor's fields make, keeping only what differs from the catalogue. Throws an Error with the text
 * to show when the right ascension or the declination is out of range.
 */
export function buildDsoOverride(
  form: DsoOverrideForm,
  current: { ra: number; dec: number },
  base: DsoCatalogChoice | null,
): DSOUserOverride {
  const override: DSOUserOverride = {};
  const names: DSOUserOverride['names'] = {};
  if (form.names.fr.trim()) names.fr = form.names.fr.trim();
  if (form.names.en.trim()) names.en = form.names.en.trim();
  if (form.names.es.trim()) names.es = form.names.es.trim();
  if (form.names.de.trim()) names.de = form.names.de.trim();
  if (Object.keys(names).length > 0) override.names = names;

  const ra = parseFloat(form.ra);
  const dec = parseFloat(form.dec);
  if (!isNaN(ra)) {
    if (ra < 0 || ra >= 360) throw new Error(t('dso.editErrorRa'));
    if (ra !== current.ra) override.ra = ra;
  }
  if (!isNaN(dec)) {
    if (dec < -90 || dec > 90) throw new Error(t('dso.editErrorDec'));
    if (dec !== current.dec) override.dec = dec;
  }
  if (shouldOverrideConstellation(form.constellation, base?.constellation)) {
    override.constellation = form.constellation;
  }
  const rating = parseInt(form.rating, 10);
  if (!isNaN(rating) && rating >= 1 && rating <= 5) override.rating = rating;
  const difficulty = parseInt(form.difficulty, 10);
  if (!isNaN(difficulty) && difficulty >= 1 && difficulty <= 5) override.difficulty = difficulty;
  if (shouldOverrideType(form.type, base?.type)) override.type = form.type as DSOType;
  return override;
}

/** The constellations to pick from, once each (Serpens has two parts), by their name in the app's language. */
export function dsoConstellationOptions(
  infos: readonly Pick<ConstellationInfo, 'id' | 'displayName'>[],
): { id: string; name: string }[] {
  const seen = new Set<string>();
  return infos
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ id: c.id, name: c.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
