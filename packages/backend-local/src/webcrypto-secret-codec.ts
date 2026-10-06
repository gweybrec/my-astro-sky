/**
 * The phone's `SecretCodec`: AES-GCM 256 with a key created once as NON-EXTRACTABLE and kept in IndexedDB, so
 * the key can be used but its bytes can never be read, by the app's code or by a backup (a backup does not
 * carry the Astrometry key at all: see `services/backup.ts`). Stored form: `enc:v2:webcrypto:<iv>:<ciphertext>`
 * (both base64; the ciphertext ends with the GCM tag).
 *
 * This is protection against copying the database file, not against code running inside the app. It is not the
 * Android Keystore: that needs another plugin, and this code is the same on iOS.
 */
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';

export const ENC_PREFIX_V2 = 'enc:v2:webcrypto:';
/** The server's form: it cannot be opened on the phone. */
const SERVER_ENC_PREFIX = 'enc:v1:aesgcm:';

/** Where the key lives. The IndexedDB version is `createIndexedDbKeyStore`; tests use one in memory. */
export interface SecretKeyStore {
  load(): Promise<CryptoKey | null>;
  save(key: CryptoKey): Promise<void>;
}

/** The part of `SubtleCrypto` / `Crypto` the codec uses. */
export interface WebCryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  subtle: {
    generateKey(
      algorithm: { name: 'AES-GCM'; length: 256 },
      extractable: boolean,
      usages: ('encrypt' | 'decrypt')[],
    ): Promise<CryptoKey>;
    encrypt(
      algorithm: { name: 'AES-GCM'; iv: Uint8Array },
      key: CryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>;
    decrypt(
      algorithm: { name: 'AES-GCM'; iv: Uint8Array },
      key: CryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>;
  };
}

const DB_NAME = 'myastrosky-secrets';
const STORE = 'keys';
const KEY_ID = 'settings-key';

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

/** Keeps the key in an IndexedDB object store (a `CryptoKey` can be stored there without being exported). */
export function createIndexedDbKeyStore(indexedDB: IDBFactory): SecretKeyStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  return {
    async load() {
      const db = await open();
      try {
        const value = await request(
          db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID),
        );
        return (value as CryptoKey | undefined) ?? null;
      } finally {
        db.close();
      }
    },
    async save(key) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(key, KEY_ID);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        });
      } finally {
        db.close();
      }
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface WebCryptoSecretCodecOptions {
  crypto: WebCryptoLike;
  /** The WebView's IndexedDB; the key is kept there. Give `keyStore` instead to keep it elsewhere. */
  indexedDB?: IDBFactory;
  keyStore?: SecretKeyStore;
}

export function createWebCryptoSecretCodec(options: WebCryptoSecretCodecOptions): SecretCodec {
  const { crypto } = options;
  const store =
    options.keyStore ??
    (options.indexedDB ? createIndexedDbKeyStore(options.indexedDB) : undefined);
  if (!store) throw new Error('createWebCryptoSecretCodec needs an indexedDB or a keyStore');

  /** The key, created on first use; concurrent first calls share one creation. */
  let creating: Promise<CryptoKey> | null = null;
  const keyForEncrypt = (): Promise<CryptoKey> => {
    creating ??= (async () => {
      const existing = await store.load();
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await store.save(key);
      return key;
    })().catch((err) => {
      creating = null;
      throw err;
    });
    return creating;
  };

  return {
    canEncrypt: () => true,

    async encrypt(plain) {
      const key = await keyForEncrypt();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
      );
      return `${ENC_PREFIX_V2}${toBase64(iv)}:${toBase64(ct)}`;
    },

    async decrypt(stored) {
      if (stored.startsWith(SERVER_ENC_PREFIX)) return null;
      if (!stored.startsWith(ENC_PREFIX_V2)) return stored;
      const parts = stored.slice(ENC_PREFIX_V2.length).split(':');
      if (parts.length !== 2) return null;
      try {
        const key = await store.load();
        if (!key) return null;
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(parts[0]) },
          key,
          fromBase64(parts[1]),
        );
        return new TextDecoder().decode(plain);
      } catch {
        return null;
      }
    },

    isEncrypted: (stored) => stored.startsWith(ENC_PREFIX_V2),
  };
}
