import crypto from 'crypto';
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';

export const ENC_PREFIX = 'enc:v1:aesgcm:';

export function getSettingsEncryptionKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

export function encryptSecret(value: string): string {
  const key = getSettingsEncryptionKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(value: string): string | null {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const key = getSettingsEncryptionKey();
  if (!key) return null;
  const payload = value.slice(ENC_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

/** The server's `SecretCodec`: the helpers above behind the asynchronous port. */
export function createServerSecretCodec(): SecretCodec {
  return {
    canEncrypt: () => getSettingsEncryptionKey() !== null,
    encrypt: async (plain) => encryptSecret(plain),
    decrypt: async (stored) => decryptSecret(stored),
    isEncrypted: (stored) => stored.startsWith(ENC_PREFIX),
  };
}
