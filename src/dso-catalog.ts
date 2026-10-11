import { getLang } from './i18n';
import { getDsoOverrides } from './api';
import { replaceUserOverrides } from '@myastrosky/core/catalog/dso-registry';
import { loadDsoCatalogData } from '@myastrosky/app-state/catalog-loaders';

export * from '@myastrosky/core/catalog/dso-registry';

export async function loadDSOCatalog(): Promise<void> {
  await loadDsoCatalogData({ lang: getLang(), getOverrides: getDsoOverrides });
}

export async function reloadUserOverrides(): Promise<void> {
  replaceUserOverrides(await getDsoOverrides());
}
