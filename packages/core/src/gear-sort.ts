/** Custom gear (ids starting with `custom-`) before the built-in catalogue, each group in its order. */
export function sortCustomFirst<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ac = a.id.startsWith('custom-');
    const bc = b.id.startsWith('custom-');
    return ac && !bc ? -1 : !ac && bc ? 1 : 0;
  });
}
