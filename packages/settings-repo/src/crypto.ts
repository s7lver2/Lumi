// apps/web/lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Loads the settings encryption key, in priority order:
 * 1. `envValue` (base64) — typically process.env.SETTINGS_ENCRYPTION_KEY
 * 2. The key file at `keyPath`, if it already exists
 * 3. A freshly generated 32-byte key, persisted to `keyPath`
 *
 * See spec §14.4: this key is intentionally never asked of the user directly.
 */
export function loadOrCreateEncryptionKey(
  keyPath: string,
  envValue?: string
): Buffer {
  if (envValue) {
    return Buffer.from(envValue, "base64");
  }

  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }

  const key = randomBytes(32);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

/**
 * Encrypts `plaintext` and returns `iv || authTag || ciphertext` as a single
 * Buffer, ready to store in `system_settings.encrypted_value` (bytea).
 */
export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decrypt(payload: Buffer, key: Buffer): string {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}