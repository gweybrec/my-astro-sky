// Points-of-interest category API shapes.

/** What a caller sends to create a category. */
export type PoiCategoryInput = { name: string; color: string };

/** What a caller sends to change a category; a field that is absent is left alone. */
export type PoiCategoryChanges = Partial<{ name: string; color: string; position: number }>;
