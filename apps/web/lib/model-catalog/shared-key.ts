// apps/web/lib/model-catalog/shared-key.ts

/**
 * ONE key, built into the app itself, the same on every Lumi install —
 * intentionally a SEPARATE constant from the dataset catalog's own shared
 * key (different trust surface: owner-only publish here vs. community
 * publish there — no reason to share a key just because the encryption
 * mechanism is the same code). Same "obfuscation, not a security boundary"
 * caveat applies (spec's Architecture section).
 */
export const MODEL_CATALOG_SHARED_KEY = Buffer.from(
  "R7hN2vLpQeK9wXmZ1sYtUiOaFdCbGjHk6nRlVzTq8yA=",
  "base64"
);
