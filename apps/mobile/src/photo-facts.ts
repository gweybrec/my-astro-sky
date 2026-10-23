import { getLang, t } from '@myastrosky/core/i18n/index';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import { CAPTURE_FIELDS } from '@myastrosky/core/capture-fields';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { formatPlanDate } from '@myastrosky/core/targets/plan';
import type { Photo } from '@myastrosky/core/types';

/** One read-only figure of a photo: a `wide` one takes a line of its own, a `mono` one is drawn in the mono face. */
export interface PhotoFact {
  label: string;
  value: string;
  wide?: boolean;
  mono?: boolean;
}

/** The capture details left out of the map's photo sheet (`brief`): the gallery's information shows them. */
const DETAILS_ONLY = new Set(['ccdTemp', 'setTemp', 'binning']);

/** Joins a list as the boards write it: "Seestar · Mosaïque". */
const joined = (items: readonly string[]) => items.join(' · ');

/**
 * What is known of a photo, as the edit page lists it, read only (the boards "Ciel, photo sélectionnée" and "Photo,
 * informations"): its file name (`fileName`), the observation date, the total exposure, the capture details, the
 * equipment, the integration rows, the labels, the points of interest, the notes and its objects (`objects`). Only the
 * facts the photo has are listed. `brief` (the map's photo sheet) leaves out the sensor temperatures and the binning.
 */
export function photoFacts(
  photo: Photo,
  options: { setupName?: string; fileName?: boolean; objects?: boolean; brief?: boolean } = {},
): PhotoFact[] {
  const out: PhotoFact[] = [];
  if (options.fileName) {
    out.push({ label: t('modal.metadataFilename'), value: photo.originalName, wide: true });
  }
  if (photo.observationDate) {
    out.push({
      label: t('modal.metadataObsDate'),
      value: formatPlanDate(photo.observationDate.slice(0, 10), getLang()),
    });
  }
  // Rows with a count and a length only, as the edit page counts them.
  const rows = (photo.integrations ?? []).filter((row) => row.frames >= 1 && row.seconds >= 1);
  const seconds = rows.reduce((sum, row) => sum + row.frames * row.seconds, 0);
  if (seconds > 0) {
    out.push({ label: t('mobile.photo.totalExposure'), value: formatIntegrationTotal(seconds) });
  }
  for (const field of CAPTURE_FIELDS) {
    if (options.brief && DETAILS_ONLY.has(field.id)) continue;
    const value = photo.captureDetails?.[field.id];
    if (value === undefined || value === '') continue;
    out.push({
      label: t(field.labelKey),
      value: field.unit ? `${value} ${field.unit}` : `${value}`,
    });
  }
  if (options.setupName) {
    out.push({ label: t('modal.metadataGearSetup'), value: options.setupName, wide: true });
  }
  if (rows.length) {
    out.push({
      label: t('modal.metadataIntegrations'),
      value: joined(
        rows.map((row) =>
          [
            row.filter,
            `${row.frames} × ${row.seconds} ${t('modal.metadataIntegrationsSecondsSuffix')}`,
          ]
            .filter(Boolean)
            .join(' '),
        ),
      ),
      wide: true,
      mono: true,
    });
  }
  if (photo.labels?.length) {
    out.push({ label: t('modal.metadataLabels'), value: joined(photo.labels), wide: true });
  }
  if (photo.pointsOfInterest?.length) {
    out.push({
      label: t('modal.metadataPoi'),
      value: joined([...new Set(photo.pointsOfInterest.map((poi) => poi.name))]),
      wide: true,
    });
  }
  if (photo.notes?.trim()) {
    out.push({ label: t('modal.metadataNotes'), value: photo.notes.trim(), wide: true });
  }
  if (options.objects && photo.dsoIds?.length) {
    out.push({
      label: t('modal.metadataDsos'),
      value: joined(sortDsoIdsByImportance(photo.dsoIds)),
      wide: true,
    });
  }
  return out;
}
