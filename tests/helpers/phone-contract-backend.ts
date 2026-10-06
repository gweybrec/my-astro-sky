/**
 * Builds the phone's backend (`createPhoneBackend`) on fakes of the plugin objects: the SQLite fake of
 * `capacitor-sqlite-db.test.ts`, an in-memory filesystem that speaks base64, Node's WebCrypto with the key kept
 * in memory, and the server's `sharp` codec. Files the app serves (`data/`, `gear/`) come from the repository.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID, webcrypto } from 'node:crypto';
import { createPhoneBackend, type PhonePlatform } from '@myastrosky/backend-local/phone-backend';
import type {
  SecretKeyStore,
  WebCryptoLike,
} from '@myastrosky/backend-local/webcrypto-secret-codec';
import type { ContractSetup } from '@myastrosky/core/testing/backend-contract';
import { createSharpImageCodec } from '../../server/image-codec';
import { buildFixtures, fileSource, resetFakeInternet } from './contract-shared';
import { createFakeFilesystem, type FakeFilesystem } from './fake-filesystem';
import { createFakeConnection } from './fake-sqlite-connection';

const ROOT = path.resolve(__dirname, '../..');
export const APP_URL = 'http://app.test';

/** A `fetch` that serves the app's own files from the repository, the stored pictures from the fake filesystem, and the rest from the (faked) internet. */
export function routedFetch(fake: FakeFilesystem): PhonePlatform['fetch'] {
  return async (url, init) => {
    if (url.startsWith(`${APP_URL}/data/`)) {
      const file = path.join(ROOT, 'public/data', url.slice(`${APP_URL}/data/`.length));
      return respond(file);
    }
    if (url.startsWith(`${APP_URL}/gear/`)) {
      return respond(path.join(ROOT, 'resources', url.slice(`${APP_URL}/gear/`.length)));
    }
    if (url.startsWith('http://localhost/_capacitor_file_')) {
      return (await fake.fetch(url)) as never;
    }
    return (await globalThis.fetch(url, init as RequestInit)) as never;
  };
}

function respond(file: string) {
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : '<!doctype html>';
  return {
    ok: true,
    status: 200,
    headers: { forEach: () => undefined },
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    json: async () => JSON.parse(text) as unknown,
  };
}

export function memoryKeyStore(): SecretKeyStore {
  let key: CryptoKey | null = null;
  return {
    load: async () => key,
    save: async (k) => {
      key = k;
    },
  };
}

export async function makePhonePlatform(): Promise<{
  platform: PhonePlatform;
  fake: FakeFilesystem;
  shared: { name: string; uri: string }[];
}> {
  const fake = createFakeFilesystem();
  const shared: { name: string; uri: string }[] = [];
  const platform: PhonePlatform = {
    sqliteConnection: createFakeConnection(),
    filesystem: fake,
    convertFileSrc: fake.convertFileSrc,
    share: {
      share: async ({ title, url }) => {
        shared.push({ name: title ?? '', uri: url ?? '' });
      },
    },
    fetch: routedFetch(fake),
    crypto: webcrypto as unknown as WebCryptoLike,
    indexedDB: undefined as unknown as IDBFactory,
    keyStore: memoryKeyStore(),
    newId: randomUUID,
    now: () => Date.now(),
    directories: { data: 'DATA', cache: 'CACHE' },
    baseUrl: APP_URL,
    images: createSharpImageCodec(),
  };
  return { platform, fake, shared };
}

/** A phone backend with nothing stored, for the backend contract. */
export async function makePhoneContractSetup(): Promise<ContractSetup> {
  resetFakeInternet();
  const { platform, fake, shared } = await makePhonePlatform();
  const backend = await createPhoneBackend(platform);
  const fixtures = await buildFixtures(async () => {
    const last = shared[shared.length - 1];
    const bytes = last ? fake.files.get(`exports/${last.name}`) : undefined;
    return last && bytes ? fileSource(last.name, bytes) : undefined;
  });
  return { backend, fixtures };
}
