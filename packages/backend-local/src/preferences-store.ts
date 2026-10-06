/**
 * The phone's `KeyValueStore`: small texts kept in the Preferences plugin. The plugin is asynchronous and the
 * store is not, so every key is read once into memory at start-up; `get` is then synchronous, and `set` and
 * `remove` update the memory at once and write behind, one write after the other, in the order they were made.
 */
import type { KeyValueStore } from '@myastrosky/core/ports/key-value-store';

/** The methods of `@capacitor/preferences` that the adapter uses. The real plugin is assignable to this. */
export interface CapacitorPreferences {
  keys(): Promise<{ keys: string[] }>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

export async function createPreferencesStore(
  preferences: CapacitorPreferences,
  onWriteError: (error: unknown) => void = () => {},
): Promise<KeyValueStore> {
  const memory = new Map<string, string>();
  const { keys } = await preferences.keys();
  for (const key of keys) {
    const { value } = await preferences.get({ key });
    if (value !== null) memory.set(key, value);
  }

  // Writes run one after the other; a failed write is reported and does not stop the ones behind it.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (write: () => Promise<void>): void => {
    queue = queue.then(write).catch(onWriteError);
  };

  return {
    get: (key) => memory.get(key) ?? null,
    set(key, value) {
      memory.set(key, value);
      enqueue(() => preferences.set({ key, value }));
    },
    remove(key) {
      memory.delete(key);
      enqueue(() => preferences.remove({ key }));
    },
  };
}
