/**
 * What the export and import screens decide before calling the backup functions: which options an export asks
 * for, how big it will be, and, for an import, which setups are locked or need a choice and what options to send.
 * Shared by the desktop's export / import windows and the phone's screen.
 */
import type {
  ExportOptions,
  ImportOptions,
  ImportPreviewResult,
  ImportPreviewSetup,
  SetupImportChoice,
} from './domain/backup';

// ─── Export ───────────────────────────────────────────────────────────────────

/** The export's tick boxes (the photos are chosen apart). */
export interface ExportFlags {
  dsoOverrides: boolean;
  customGear: boolean;
  setups: boolean;
  poiCategories: boolean;
  skyRegions: boolean;
  plans: boolean;
  shortcuts: boolean;
}

/** The options of an export: images come with the selected photos, and photo metadata always travels with them. */
export function buildExportOptions(flags: ExportFlags, selectedPhotoCount: number): ExportOptions {
  return {
    includeImages: selectedPhotoCount > 0,
    includeMetadata: true,
    includeDsoOverrides: flags.dsoOverrides,
    includeCustomGear: flags.customGear,
    includeSetups: flags.setups,
    includePoiCategories: flags.poiCategories,
    includeSkyRegions: flags.skyRegions,
    includePlans: flags.plans,
    includeShortcuts: flags.shortcuts,
  };
}

/** An export needs at least one thing in it. */
export function canExport(flags: ExportFlags, selectedPhotoCount: number): boolean {
  return selectedPhotoCount > 0 || Object.values(flags).some(Boolean);
}

/** The size in bytes of the selected photos' files (a photo with no known size counts for 0). */
export function selectedPhotoBytes(
  photos: readonly { id: string; fileSize?: number | null }[],
  selected: ReadonlySet<string>,
): number {
  return photos.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (p.fileSize ?? 0), 0);
}

// ─── Import ───────────────────────────────────────────────────────────────────

/** What the user has ticked in an import preview. */
export interface ImportSelection {
  importDso: boolean;
  importPoiCategories: boolean;
  importSkyRegions: boolean;
  importShortcuts: boolean;
  images: ReadonlySet<string>;
  plans: ReadonlySet<string>;
  setups: ReadonlySet<string>;
  gear: ReadonlySet<string>;
  /** Choice per setup id, for the setups whose content differs from a local one. */
  setupChoices: Readonly<Record<string, SetupImportChoice>>;
}

/** Names of the ticked plans whose setup is `setupId`, by setup id. */
export function tickedPlanNamesBySetup(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of preview.plans) {
    if (!p.setupId || !tickedPlans.has(p.id)) continue;
    map.set(p.setupId, [...(map.get(p.setupId) ?? []), p.name]);
  }
  return map;
}

/** A ticked plan needs this setup. */
export function setupRequired(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
  s: ImportPreviewSetup,
): boolean {
  return (tickedPlanNamesBySetup(preview, tickedPlans).get(s.id) ?? []).length > 0;
}

/** A setup with no local counterpart that a ticked plan needs: shown ticked, cannot be unticked. */
export function setupLocked(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
  s: ImportPreviewSetup,
): boolean {
  return s.conflict === 'none' && setupRequired(preview, tickedPlans, s);
}

/** A setup is imported: ticked (or locked); one identical to a local setup is never imported. */
export function setupTicked(
  preview: ImportPreviewResult,
  sel: Pick<ImportSelection, 'plans' | 'setups'>,
  s: ImportPreviewSetup,
): boolean {
  return s.conflict !== 'identical' && (sel.setups.has(s.id) || setupLocked(preview, sel.plans, s));
}

/** A different setup that will be imported, or that a ticked plan needs, must be told what to do. */
export function setupNeedsChoice(
  preview: ImportPreviewResult,
  sel: Pick<ImportSelection, 'plans' | 'setups'>,
  s: ImportPreviewSetup,
): boolean {
  return (
    s.conflict === 'different' && (sel.setups.has(s.id) || setupRequired(preview, sel.plans, s))
  );
}

/** The three choices offered for a different setup, in order, with the i18n key of each label. */
export const SETUP_CHOICES: readonly { value: SetupImportChoice; label: string }[] = [
  { value: 'replace', label: 'settings.importSetupReplace' },
  { value: 'keepBoth', label: 'settings.importSetupKeepBoth' },
  { value: 'skip', label: 'settings.importSetupSkip' },
];

/** A setup that needs a choice has none yet: the import cannot start. */
export function setupChoiceMissing(preview: ImportPreviewResult, sel: ImportSelection): boolean {
  return preview.setups.some((s) => setupNeedsChoice(preview, sel, s) && !sel.setupChoices[s.id]);
}

/** "Do not import" on a setup no ticked plan needs is the same as unticking it: the choice is not kept. */
export function setupChoiceUnticks(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
  s: ImportPreviewSetup,
  choice: SetupImportChoice,
): boolean {
  return choice === 'skip' && !setupRequired(preview, tickedPlans, s);
}

/** At least one thing is ticked. */
export function canImport(preview: ImportPreviewResult, sel: ImportSelection): boolean {
  return (
    sel.images.size > 0 ||
    sel.plans.size > 0 ||
    sel.setups.size > 0 ||
    sel.gear.size > 0 ||
    (preview.hasDsoOverrides && sel.importDso) ||
    (preview.hasPoiCategories && sel.importPoiCategories) ||
    (preview.hasSkyRegions && sel.importSkyRegions) ||
    (preview.hasShortcuts && sel.importShortcuts)
  );
}

/** The options to send to the restore: the choices are kept for the setups that need one. */
export function buildImportOptions(
  preview: ImportPreviewResult,
  sel: ImportSelection,
): ImportOptions {
  return {
    // Photo metadata always travels with the photos that get imported.
    importMetadata: preview.hasMetadata,
    importDsoOverrides: preview.hasDsoOverrides && sel.importDso,
    importPoiCategories: preview.hasPoiCategories && sel.importPoiCategories,
    importSkyRegions: preview.hasSkyRegions && sel.importSkyRegions,
    selectedImages: preview.images.length > 0 ? Array.from(sel.images) : null,
    selectedPlans: Array.from(sel.plans),
    selectedSetups: Array.from(sel.setups),
    selectedGear: Array.from(sel.gear),
    setupConflicts: Object.fromEntries(
      preview.setups
        .filter((s) => setupNeedsChoice(preview, sel, s) && sel.setupChoices[s.id])
        .map((s) => [s.id, sel.setupChoices[s.id]]),
    ),
  };
}
