import type { CustomGearType } from '@myastrosky/core/gear-catalog';

// The item the add page saved last, for the page it returns to: the setup's page chooses a telescope added from its
// picker ("Ajouter un télescope").
let added: { kind: CustomGearType; id: string } | null = null;

export function gearAdded(kind: CustomGearType, id: string): void {
  added = { kind, id };
}

/** The id saved last for `kind`, once: the next call returns `null`. */
export function takeGearAdded(kind: CustomGearType): string | null {
  if (added?.kind !== kind) return null;
  const { id } = added;
  added = null;
  return id;
}
