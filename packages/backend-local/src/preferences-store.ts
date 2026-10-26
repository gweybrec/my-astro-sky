/**
 * The phone's `KeyValueStore`: small texts kept in the Preferences plugin. The plugin is asynchronous and the
 * store is not, so every key is read once into memory at start-up; `get` is then synchronous, and `set` and
 * `remove` update the memory at once and hand the write to the plugin in the same turn, without waiting for the
 * writes before it: a write waiting in a queue here would be lost if the app were killed. The plugin runs the
 * calls one after the other in the order they were made (on Android, on its single plugin thread).
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
  // The plugin has no call that reads every value: the reads are made together, so start-up waits for one of them.
  const values = await Promise.all(keys.map((key) => preferences.get({ key })));
  keys.forEach((key, i) => {
    const { value } = values[i];
    if (value !== null) memory.set(key, value);
  });

  // A failed write is reported and does not stop the ones after it.
  const write = (call: Promise<void>): void => {
    call.catch(onWriteError);
  };

  return {
    get: (key) => memory.get(key) ?? null,
    set(key, value) {
      memory.set(key, value);
      write(preferences.set({ key, value }));
    },
    remove(key) {
      memory.delete(key);
      write(preferences.remove({ key }));
    },
  };
}
