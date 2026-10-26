/** The subset of a catalog filter this module needs — keeps it free of gear-catalog imports. */
export interface FilterCatalogEntry {
  label: string;
  color: string;
  detail: string | null;
  brand: string;
  model: string;
  series: string | null;
  subtype: string;
}
