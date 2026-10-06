// The pure rules of a backup bundle live in core; this module keeps the old import path.
export {
  buildZipPreviewResponse,
  classifyBundleSetup,
  idsToReplaceByName,
  inspectZipContents,
  isValidZipEntryPath,
  parseBundlePlanSetupIds,
  parseBundleSetups,
  parseManifestPhotos,
  planSetupImportActions,
} from '@myastrosky/core/domain/backup';
export type {
  ImportPreviewResponse,
  PreviewGearEntry,
  PreviewImageEntry,
  PreviewPlanEntry,
  PreviewSetupEntry,
  SetupImportAction,
  SetupImportPlan,
  ZipEntry,
  ZipInspectResult,
} from '@myastrosky/core/domain/backup';
export { validateDsoOverrideCoords } from '@myastrosky/core/services/dso-overrides';
