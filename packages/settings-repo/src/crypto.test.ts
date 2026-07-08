// apps/web/lib/crypto.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateEncryptionKey, encrypt, decrypt } from "./crypto";

let dir: string;
let keyPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "netryx-crypto-test-"));
  keyPath = join(dir, "settings.key");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateEncryptionKey", () => {
  it("creates a 32-byte key file if none exists", () => {
    expect(existsSync(keyPath)).toBe(false);
    const key = loadOrCreateEncryptionKey(keyPath);
    expect(key.length).toBe(32);
    expect(existsSync(keyPath)).toBe(true);
  });

  it("reuses the existing key file on subsequent calls", () => {
    const first = loadOrCreateEncryptionKey(keyPath);
    const second = loadOrCreateEncryptionKey(keyPath);
    expect(second.equals(first)).toBe(true);
  });

  it("prefers SETTINGS_ENCRYPTION_KEY env var over the file when set", () => {
    const envKey = Buffer.alloc(32, 7).toString("base64");
    const key = loadOrCreateEncryptionKey(keyPath, envKey);
    expect(key.toString("base64")).toBe(envKey);
    expect(existsSync(keyPath)).toBe(false);
  });
});

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", () => {
    const key = loadOrCreateEncryptionKey(keyPath);
    const ciphertext = encrypt("AIzaSyTestSecretValue", key);
    expect(ciphertext).not.toEqual(Buffer.from("AIzaSyTestSecretValue"));
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe("AIzaSyTestSecretValue");
  });

  it("fails to decrypt with the wrong key", () => {
    const key = loadOrCreateEncryptionKey(keyPath);
    const wrongKeyPath = join(dir, "other.key");
    const wrongKey = loadOrCreateEncryptionKey(wrongKeyPath);
    const ciphertext = encrypt("secret", key);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});