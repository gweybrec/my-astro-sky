import type { KeyValueStore } from '../ports/key-value-store';

/** The default store: kept in memory, lost when the app closes. */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => (map.has(key) ? map.get(key)! : null),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

let current: KeyValueStore = createMemoryStore();

/** Called once at start-up by each platform (see `src/platform-init.ts`). */
export function configureStorage(store: KeyValueStore): void {
  current = store;
}

export function storage(): KeyValueStore {
  return current;
}
