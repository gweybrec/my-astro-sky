import { getLang, t } from './i18n/index';
import { CAPTURE_FIELDS } from './capture-fields';
import { formatIntegrationTotal } from './format-utils';
import {
  integrationRowHasData,
  integrationRowTime,
  integrationTotalSeconds,
} from './integration-rows';
import { formatPlanDate } from './targets/plan';
import type { Photo } from './types';

/**
 * One read-only figure of a photo: a `mono` one is drawn in the mono face; a `line` one takes a line of its own, cut
 * with "…" when too long; a map sheet first stops under the line of the `stop` one (the equipment). The exposures
 * also come one per row in `exposures` (time and filter apart, the filter drawn as its badge after the time; a row
 * with only a filter has an empty time), for a place that lists them a line each. A `wide`
 * one (equipment, notes) is long text that a narrow place shows under its label rather than beside it.
 */
export interface PhotoFact {
  label: string;
  value: string;
  exposures?: { time: string; filter: string }[];
  mono?: boolean;
  line?: boolean;
  stop?: boolean;
  wide?: boolean;
}

/** The capture details left out of the map's photo sheet (`brief`): the gallery's information shows them. */
const DETAILS_ONLY = new Set(['ccdTemp', 'setTemp', 'binning']);

/** Joins a list as the boards write it: "Seestar · Mosaïque". */
const joined = (items: readonly string[]) => items.join(' · ');

/**
 * What is known of a photo, as the edit page lists it, read only (the boards "Ciel, photo sélectionnée" and "Photo,
 * informations"): its file name (`fileName`), the observation date, the total exposure, the capture details, the
 * equipment, the integration rows, the labels, the points of interest and the notes (its objects are chips, in
 * `PhoneChipPager`). Only the facts the photo has are listed. `brief` (the map's photo sheet) leaves out the sensor temperatures and the binning. `noChips` leaves out the labels and points of interest, for a place that shows them as chips.
 */
export function photoFacts(
  photo: Photo,
  options: { setupName?: string; fileName?: boolean; brief?: boolean; noChips?: boolean } = {},
): PhotoFact[] {
  const out: PhotoFact[] = [];
  // A visited sky's photo: its author first, on a line of its own (boards "Photo d'un ciel visité" and "Ciel,
  // photo d'un ciel visité"), as the sender named themselves; never editable here.
  if (photo.author) out.push({ label: t('sharedSky.author'), value: photo.author, line: true });
  if (options.fileName) {
    out.push({ label: t('modal.metadataFilename'), value: photo.originalName });
  }
  if (photo.observationDate) {
    out.push({
      label: t('modal.metadataObsDate'),
      value: formatPlanDate(photo.observationDate.slice(0, 10), getLang()),
    });
  }
  // Every row the user wrote something in; only those with a count and a length make the total.
  const rows = (photo.integrations ?? []).filter(integrationRowHasData);
  const seconds = integrationTotalSeconds(rows);
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
    out.push({
      label: t('modal.metadataGearSetup'),
      value: options.setupName,
      stop: true,
      wide: true,
    });
  }
  // A visited sky's photo carries its gear as the sender named it (board "Photo d'un ciel visité").
  const gear = photo.sharedGear;
  if (gear) {
    const gearFacts: [string, string | undefined][] = [
      ['modal.metadataGearSetup', gear.setup],
      ['targets.gear.telescope', gear.telescope],
      ['targets.gear.camera', gear.camera],
      ['targets.gear.accessory', gear.accessory],
    ];
    let first = true;
    for (const [label, value] of gearFacts) {
      if (!value) continue;
      out.push({ label: t(label), value, wide: true, ...(first ? { stop: true } : {}) });
      first = false;
    }
  }
  if (rows.length) {
    const na = t('modal.metadataIntegrationsFieldNA');
    const suffix = ` ${t('modal.metadataIntegrationsSecondsSuffix')}`;
    const exposures = rows.map((row) => ({
      time: integrationRowTime(row, na, suffix),
      filter: row.filter,
    }));
    out.push({
      label: t('modal.metadataIntegrations'),
      value: joined(exposures.map((e) => [e.time, e.filter].filter(Boolean).join(' '))),
      exposures,
    });
  }
  if (!options.noChips && photo.labels?.length) {
    out.push({ label: t('modal.metadataLabels'), value: joined(photo.labels) });
  }
  if (!options.noChips && photo.pointsOfInterest?.length) {
    out.push({
      label: t('modal.metadataPoi'),
      value: joined([...new Set(photo.pointsOfInterest.map((poi) => poi.name))]),
    });
  }
  if (photo.notes?.trim()) {
    out.push({ label: t('modal.metadataNotes'), value: photo.notes.trim(), wide: true });
  }
  return out;
}

/**
 * The parts of a photo's summary: its equipment, total exposure and observation date
 * (["Seestar S50", "2h15", "12 oct. 2025"]), only the parts the photo has; empty when it has none.
 */
export function photoSummaryParts(photo: Photo, setupName?: string): string[] {
  const seconds = integrationTotalSeconds(photo.integrations ?? []);
  return [
    setupName ?? photo.sharedGear?.setup,
    seconds > 0 ? formatIntegrationTotal(seconds) : undefined,
    photo.observationDate
      ? formatPlanDate(photo.observationDate.slice(0, 10), getLang())
      : undefined,
  ].filter((part): part is string => !!part);
}

/** The summary of a photo on one line: "Seestar S50 · 2h15 · 12 oct. 2025". */
export function photoSummary(photo: Photo, setupName?: string): string {
  return joined(photoSummaryParts(photo, setupName));
}
