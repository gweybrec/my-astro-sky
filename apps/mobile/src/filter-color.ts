import { catalogFilterColor } from '@myastrosky/core/gear-catalog';
import { filterCssKey } from '@myastrosky/core/filter-keys';

const readVar = (cssVar: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();

/** A filter's colour (a dot, a band of the altitude chart): the catalogue filter's, else the filter band's text token. */
export const filterColor = (filter: string | null | undefined) =>
  (filter && catalogFilterColor(filter)) || readVar(`--filter-${filterCssKey(filter)}-text`);
