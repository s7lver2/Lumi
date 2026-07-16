// apps/web/lib/datasets/shared-key.ts

/**
 * ONE key, built into the app itself, the same on every Lumi install — NOT
 * derived from this install's own SETTINGS_ENCRYPTION_KEY. This is
 * obfuscation from someone browsing a published dataset's GitHub repo
 * directly without running Lumi, not a security boundary — it's
 * extractable from this open-source app by anyone who looks (spec's "Key
 * model" section). Never mistake a decrypted bundle for "vetted/trusted" —
 * that's the job of the validation pipeline (validate-bundle.ts,
 * manifest.ts), not this encryption.
 */
export const DATASET_SHARED_KEY = Buffer.from(
  "8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=",
  "base64"
);
