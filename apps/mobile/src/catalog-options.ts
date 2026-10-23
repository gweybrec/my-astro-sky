import { t } from '@myastrosky/core/i18n/index';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';

/** The deep-sky catalogues to choose from, with their names (the map's display sheet, a photo's drawn objects). */
export const dsoCatalogOptions = () =>
  DSO_CATALOGS_ALL.map((value) => ({ value, label: t(`dso.catalogLabels.${value}`) }));
