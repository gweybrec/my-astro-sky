// @vitest-environment node
/** The phone's secret codec with Node's `crypto.webcrypto` and a key store in memory (no `fake-indexeddb`). */
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createWebCryptoSecretCodec,
  type SecretKeyStore,
  type WebCryptoLike,
} from '@myastrosky/backend-local/webcrypto-secret-codec';

const crypto = webcrypto as unknown as WebCryptoLike;

function memoryKeyStore(): SecretKeyStore & { saves: number; key: CryptoKey | null } {
  const store = {
    saves: 0,
    key: null as CryptoKey | null,
    async load() {
      await Promise.resolve();
      return store.key;
    },
    async save(key: CryptoKey) {
      await Promise.resolve();
      store.saves++;
      store.key = key;
    },
  };
  return store;
}

describe('createWebCryptoSecretCodec', () => {
  it('encrypts to the enc:v2:webcrypto form and decrypts back', async () => {
    const codec = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    expect(codec.canEncrypt()).toBe(true);
    const stored = await codec.encrypt('my-api-key-é');
    expect(stored).toMatch(/^enc:v2:webcrypto:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('my-api-key');
    expect(codec.isEncrypted(stored)).toBe(true);
    expect(await codec.decrypt(stored)).toBe('my-api-key-é');
  });

  it('uses a new random IV each time', async () => {
    const codec = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    expect(await codec.encrypt('x')).not.toBe(await codec.encrypt('x'));
  });

  it('creates the key once, non-extractable, even for concurrent first calls', async () => {
    const keys = memoryKeyStore();
    const codec = createWebCryptoSecretCodec({ crypto, keyStore: keys });
    await Promise.all([codec.encrypt('a'), codec.encrypt('b'), codec.encrypt('c')]);
    expect(keys.saves).toBe(1);
    expect(keys.key!.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey('raw', keys.key!)).rejects.toThrow();
  });

  it('a second codec on the same key store opens what the first wrote', async () => {
    const keys = memoryKeyStore();
    const stored = await createWebCryptoSecretCodec({ crypto, keyStore: keys }).encrypt('k');
    expect(await createWebCryptoSecretCodec({ crypto, keyStore: keys }).decrypt(stored)).toBe('k');
  });

  it('returns a value without the prefix unchanged', async () => {
    const codec = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    expect(await codec.decrypt('plain-key')).toBe('plain-key');
    expect(codec.isEncrypted('plain-key')).toBe(false);
  });

  it('returns null for the server form, a tampered value, another key, or no key', async () => {
    const codec = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    expect(await codec.decrypt('enc:v1:aesgcm:AAAA:BBBB:CCCC')).toBeNull();
    const stored = await codec.encrypt('secret');
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await codec.decrypt(tampered)).toBeNull();
    expect(await codec.decrypt('enc:v2:webcrypto:onlyone')).toBeNull();
    const other = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    await other.encrypt('warm-up');
    expect(await other.decrypt(stored)).toBeNull();
    const empty = createWebCryptoSecretCodec({ crypto, keyStore: memoryKeyStore() });
    expect(await empty.decrypt(stored)).toBeNull();
  });

  it('needs a key store or an indexedDB', () => {
    expect(() => createWebCryptoSecretCodec({ crypto })).toThrow();
  });
});
