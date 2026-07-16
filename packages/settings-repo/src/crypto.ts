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

function encryptRaw(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptRaw(payload: Buffer, key: Buffer): Buffer {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts `plaintext` and returns `iv || authTag || ciphertext` as a single
 * Buffer, ready to store in `system_settings.encrypted_value` (bytea).
 */
export function encrypt(plaintext: string, key: Buffer): Buffer {
  return encryptRaw(Buffer.from(plaintext, "utf8"), key);
}

export function decrypt(payload: Buffer, key: Buffer): string {
  return decryptRaw(payload, key).toString("utf8");
}

/** Same scheme as encrypt()/decrypt(), but for raw binary payloads (zip
 * bundles, image bytes) that must never round-trip through a UTF-8 string —
 * used by the dataset catalog (docs/superpowers/specs/2026-07-13-dataset-
 * catalog-design.md). */
export function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  return encryptRaw(plaintext, key);
}

export function decryptBuffer(payload: Buffer, key: Buffer): Buffer {
  return decryptRaw(payload, key);
}