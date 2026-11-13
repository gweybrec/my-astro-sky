/**
 * What the photo view shows of a visited sky's photo instead of the metadata editor: the same information, as text.
 * The photo is someone else's, so nothing here can be changed. The rows are worked out apart from the page
 * (`visitPhotoInfoRows`) and built with the editor's own label style.
 */
import type { Photo } from '@myastrosky/core/types';
import { getCaptureField } from '@myastrosky/core/capture-fields';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { getLang, t } from './i18n';

export interface VisitPhotoInfoRow {
  /** The row's label, translated. */
  label: string;
  /** Its lines of text. */
  lines: string[];
  /** Kept to one line, cut with "…" when too long (the author, whose name may be long). */
  oneLine?: boolean;
}

/** One line per exposure row: "120 × 180 s = 6h00, Ha"; a missing count or time is left out of the total. */
function integrationLines(photo: Photo): string[] {
  const suffix = t('modal.metadataIntegrationsSecondsSuffix');
  const na = t('modal.metadataIntegrationsFieldNA');
  return (photo.integrations ?? []).map((row) => {
    const frames = row.frames >= 1 ? String(row.frames) : na;
    const seconds = row.seconds >= 1 ? `${row.seconds}${suffix}` : na;
    let line = `${frames} × ${seconds}`;
    if (row.frames >= 1 && row.seconds >= 1) {
      line += ` = ${formatIntegrationTotal(row.frames * row.seconds)}`;
    }
    return row.filter ? `${line}, ${row.filter}` : line;
  });
}

/**
 * The rows of a visited photo's information, in the editor's order; a row with nothing to say is left out.
 * `lang` is the language dates are written in.
 */
export function visitPhotoInfoRows(photo: Photo, lang: string = getLang()): VisitPhotoInfoRow[] {
  const rows: VisitPhotoInfoRow[] = [];
  const add = (label: string, lines: (string | undefined | null | false)[]) => {
    const kept = lines.filter((line): line is string => !!line);
    if (kept.length > 0) rows.push({ label, lines: kept });
  };

  // First, on a line of its own: who took the photo, as the sender named themselves.
  if (photo.author)
    rows.push({ label: t('sharedSky.author'), lines: [photo.author], oneLine: true });

  add(t('modal.metadataIntegrations'), integrationLines(photo));
  const date = photo.observationDate ? new Date(photo.observationDate) : null;
  add(t('modal.metadataObsDate'), [
    date && !Number.isNaN(date.getTime()) && date.toLocaleString(lang),
  ]);
  const gear = photo.sharedGear ?? {};
  add(t('modal.metadataGearSetup'), [
    gear.setup,
    gear.telescope && `${t('targets.gear.telescope')} : ${gear.telescope}`,
    gear.camera && `${t('targets.gear.camera')} : ${gear.camera}`,
    gear.accessory && `${t('targets.gear.accessory')} : ${gear.accessory}`,
  ]);
  add(
    t('modal.metadataCapture'),
    Object.entries(photo.captureDetails ?? {}).map(([id, value]) => {
      const field = getCaptureField(id);
      return field && `${t(field.labelKey)} : ${value}${field.unit ? ` ${field.unit}` : ''}`;
    }),
  );
  add(t('modal.metadataNotes'), [photo.notes?.trim()]);
  return rows;
}

/** The read-only block: its author, its targets, labels and points as chips, then the other rows. */
export function buildVisitPhotoInfo(photo: Photo, options: { chips: HTMLElement }): HTMLElement {
  const wrap = document.createElement('div');
  const rows = visitPhotoInfoRows(photo);
  const author = rows[0]?.oneLine ? rows.shift() : undefined;
  const addRow = (row: VisitPhotoInfoRow) => {
    const label = document.createElement('div');
    label.className = 'metadata-label';
    label.textContent = row.label;
    wrap.appendChild(label);
    for (const line of row.lines) {
      const text = document.createElement('p');
      text.className = row.oneLine ? 'text-para text-ellipsis' : 'text-para whitespace-pre-wrap';
      text.textContent = line;
      // The whole name on hover when it is cut.
      if (row.oneLine) text.title = line;
      wrap.appendChild(text);
    }
  };

  if (author) addRow(author);
  if (options.chips.childElementCount > 0) {
    // The gallery card's chips are cut to two lines; here every object, label and point shows.
    options.chips.classList.add('!max-h-none');
    wrap.appendChild(options.chips);
  }
  for (const row of rows) addRow(row);
  return wrap;
}
