import { describe, it, expect } from 'vitest';
import {
  createPreferencesStore,
  type CapacitorPreferences,
} from '@myastrosky/backend-local/preferences-store';

/** A fake plugin: a map, a log of the writes, and a switch to make one write slow or failing. */
function fakePlugin(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  const plugin: CapacitorPreferences & { delayKey?: string; failKey?: string } = {
    async keys() {
      return { keys: [...data.keys()] };
    },
    async get({ key }) {
      return { value: data.get(key) ?? null };
    },
    async set({ key, value }) {
      if (plugin.delayKey === key) await new Promise((r) => setTimeout(r, 20));
      if (plugin.failKey === key) throw new Error('disk full');
      log.push(`set ${key}=${value}`);
      data.set(key, value);
    },
    async remove({ key }) {
      log.push(`remove ${key}`);
      data.delete(key);
    },
  };
  return { plugin, data, log };
}
const settle = () => new Promise((r) => setTimeout(r, 60));

describe('createPreferencesStore', () => {
  it('reads every stored key once, then answers synchronously', async () => {
    const { plugin } = fakePlugin({ lang: 'de', other: 'x' });
    const store = await createPreferencesStore(plugin);
    expect(store.get('lang')).toBe('de');
    expect(store.get('other')).toBe('x');
    expect(store.get('missing')).toBeNull();
  });

  it('set and remove show in memory at once and reach the plugin afterwards', async () => {
    const { plugin, data } = fakePlugin({ a: '1' });
    const store = await createPreferencesStore(plugin);
    store.set('b', '2');
    store.remove('a');
    expect(store.get('b')).toBe('2');
    expect(store.get('a')).toBeNull();
    expect(data.has('b')).toBe(false);
    await settle();
    expect([...data.entries()]).toEqual([['b', '2']]);
  });

  it('writes in the order the calls were made, even when an earlier write is slower', async () => {
    const { plugin, log } = fakePlugin();
    plugin.delayKey = 'slow';
    const store = await createPreferencesStore(plugin);
    store.set('slow', '1');
    store.set('fast', '2');
    store.remove('slow');
    await settle();
    expect(log).toEqual(['set slow=1', 'set fast=2', 'remove slow']);
  });

  it('reports a failed write and carries on with the next ones', async () => {
    const { plugin, log } = fakePlugin();
    plugin.failKey = 'bad';
    const errors: unknown[] = [];
    const store = await createPreferencesStore(plugin, (e) => errors.push(e));
    store.set('bad', '1');
    store.set('good', '2');
    await settle();
    expect(errors).toHaveLength(1);
    expect(log).toEqual(['set good=2']);
    expect(store.get('bad')).toBe('1');
  });
});
