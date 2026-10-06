/**
 * Protects a secret setting (the Astrometry API key) before it is stored. The server uses AES-256-GCM
 * with a key from the environment; the phone will use the platform keystore.
 */
export interface SecretCodec {
  /** True when `encrypt` really encrypts (an encryption key is configured). */
  canEncrypt(): boolean;
  /** Returns the encrypted form of `plain`; returns `plain` unchanged when it cannot encrypt. */
  encrypt(plain: string): Promise<string>;
  /** Returns the plain text of `stored`; returns `stored` itself for a value that is not encrypted, and `null` when it cannot be decrypted. */
  decrypt(stored: string): Promise<string | null>;
  /** True when `stored` has the form that `encrypt` produces. */
  isEncrypted(stored: string): boolean;
}
