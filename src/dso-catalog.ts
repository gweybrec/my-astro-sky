import type { DSOUserOverride } from './types';
import { getLang } from './i18n';
import { getDsoOverrides } from './api';
import { replaceUserOverrides, setDsoCatalog } from '@myastrosky/core/catalog/dso-registry';

export * from '@myastrosky/core/catalog/dso-registry';

export async function loadDSOCatalog(): Promise<void> {
  const json = await fetch('/data/dso.json').then((r) => r.json());

  // Apply any existing user overrides from the server
  let overrides: Record<string, DSOUserOverride> = {};
  try {
    overrides = await getDsoOverrides();
  } catch {
    // Silently ignore if user overrides can't be loaded
  }

  setDsoCatalog(json, overrides, getLang());
}

export async function reloadUserOverrides(): Promise<void> {
  replaceUserOverrides(await getDsoOverrides());
}
