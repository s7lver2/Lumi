// packages/settings-repo/src/settings-repo.ts
import type { Pool } from "pg";
import { loadOrCreateEncryptionKey, encrypt, decrypt } from "./crypto";

const SETUP_COMPLETED_KEY = "__setup_completed__";

export interface SettingWrite {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface SettingsRepoOptions {
  pool: Pool;
  encryptionKeyPath: string;
  cacheTtlMs?: number;
}

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

export function createSettingsRepo(options: SettingsRepoOptions) {
  const { pool, encryptionKeyPath } = options;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const cache = new Map<string, CacheEntry>();

  function getKey(): Buffer {
    return loadOrCreateEncryptionKey(
      encryptionKeyPath,
      process.env.SETTINGS_ENCRYPTION_KEY
    );
  }

  function invalidate(key: string) {
    cache.delete(key);
  }

  async function getSetting(key: string): Promise<string | null> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = $1",
      [key]
    );

    let value: string | null = null;
    if (rows.length > 0) {
      const row = rows[0];
      value = row.encrypted_value
        ? decrypt(row.encrypted_value, getKey())
        : row.value;
    }

    cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
    return value;
  }

  async function setSetting(
    key: string,
    value: string,
    isSecret: boolean
  ): Promise<void> {
    if (isSecret) {
      const encrypted = encrypt(value, getKey());
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, NULL, $2, true, now())
         ON CONFLICT (key) DO UPDATE
           SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
        [key, encrypted]
      );
    } else {
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, $2, NULL, false, now())
         ON CONFLICT (key) DO UPDATE
           SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
        [key, value]
      );
    }
    invalidate(key);
  }

  async function isSetupCompleted(): Promise<boolean> {
    const value = await getSetting(SETUP_COMPLETED_KEY);
    return value === "true";
  }

  async function completeSetup(writes: SettingWrite[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const { key, value, isSecret } of writes) {
        if (isSecret) {
          const encrypted = encrypt(value, getKey());
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, NULL, $2, true, now())
             ON CONFLICT (key) DO UPDATE
               SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
            [key, encrypted]
          );
        } else {
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, $2, NULL, false, now())
             ON CONFLICT (key) DO UPDATE
               SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
            [key, value]
          );
        }
      }
      await client.query(
        `INSERT INTO system_settings (key, value, is_secret, updated_at)
         VALUES ($1, 'true', false, now())
         ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
        [SETUP_COMPLETED_KEY]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      for (const { key } of writes) invalidate(key);
      invalidate(SETUP_COMPLETED_KEY);
    }
  }

  return { getSetting, setSetting, isSetupCompleted, completeSetup };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;