// packages/shared-types/src/settings.ts
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";
// DEFAULT_CONFIRM_THRESHOLD's canonical home is search.ts (the refine/verify
// domain, spec §9.3) — imported here only to seed this setting's default so
// the value isn't duplicated (previously declared independently in both
// files, which broke the barrel's star export).
import { DEFAULT_CONFIRM_THRESHOLD } from "./search";

export type SettingType = "string" | "number" | "enum" | "slider";

export interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  isSecret: boolean;
  required: boolean;
  defaultValue?: string;
  /** Required when type is "enum" — the set of values validateSettingValue accepts. */
  options?: string[];
  /** Required when type is "slider" — inclusive bounds. */
  min?: number;
  max?: number;
  /** UI granularity for type "slider" (the <input type="range">'s step attribute). Defaults to 1 if unset. */
  step?: number;
}

/** VERIFICATION_TILE_PASSES's default — reproduces Laila's original fixed
 * tile schedule (full image + 2x2 grid) exactly, so the new slider setting
 * doesn't change anything for existing users until they move it. */
export const DEFAULT_VERIFICATION_TILE_PASSES = 5;

/** Mirrors services/inference/verify.py's DEFAULT_VERIFY_CONFIG exactly —
 * these 4 settings expose that calibration to the Settings UI instead of
 * only being editable by changing Python source. Defaults reproduce the
 * original hardcoded values, so existing users see no behavior change. */
export const DEFAULT_VERIFICATION_MIN_INLIERS = 4;
export const DEFAULT_VERIFICATION_INLIER_SATURATION = 3000;
export const DEFAULT_VERIFICATION_ERROR_SCALE_PX = 8.0;
export const DEFAULT_VERIFICATION_MAGSAC_THRESHOLD_PX = 3.0;

export const SETTINGS_SCHEMA: SettingDefinition[] = [
  {
    key: "GOOGLE_MAPS_API_KEY",
    label: "Street View Static API key",
    type: "string",
    isSecret: true,
    required: true,
  },
  {
    key: "MAPBOX_TOKEN",
    label: "Mapbox token (optional — leave empty to use MapLibre + free tiles)",
    type: "string",
    isSecret: true,
    required: false,
  },
  {
    key: "MAX_AREA_KM2",
    label: "Maximum area per indexing job (km²)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "5",
  },
  {
    key: "MAX_MONTHLY_BUDGET_USD",
    label: "Maximum monthly Street View spend (USD)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "50",
  },
  {
    key: "MAX_CONCURRENT_REQUESTS",
    label: "Maximum concurrent Street View requests",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "10",
  },
  {
    key: "STREET_VIEW_PRICE_PER_IMAGE_USD",
    label: "Street View Static API price per image (USD)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0.007",
  },
  {
    key: "RETRIEVAL_MODEL",
    label: "Retrieval model",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "lumi-preview",
    options: RETRIEVAL_MODELS.map((m) => m.id),
  },
  {
    key: "VERIFICATION_MODEL",
    label: "Verification model",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "laila",
    options: VERIFICATION_MODELS.map((m) => m.id),
  },
  {
    key: "VERIFICATION_CONFIRM_THRESHOLD",
    label: "Auto-confirm threshold for verification score (0–1)",
    type: "slider",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_CONFIRM_THRESHOLD),
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    // 1-10 slider (services/inference/tiles.py's multiscale_tiles schedule):
    // 1 = full image only (fastest, least precise), 10 = the full 10-tile
    // schedule (slowest, most precise). 5 reproduces Laila's ORIGINAL fixed
    // behavior (full image + 2x2 grid) — kept as the default. Requires
    // restarting the inference service to apply, same as RETRIEVAL_MODEL/
    // VERIFICATION_MODEL (read once at startup, spec §15.4).
    key: "VERIFICATION_TILE_PASSES",
    label: "Pasadas de verificación Laila (1 = rápido, 10 = lento y más preciso)",
    type: "slider",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_VERIFICATION_TILE_PASSES),
    min: 1,
    max: 10,
  },
  {
    // Below this many RoMa inlier matches, verify.py's calibrate_score()
    // doesn't trust the homography at all and scores 0 outright — raising
    // this makes verification stricter (fewer, more confident matches);
    // lowering it lets weaker matches still get a (low) score instead of 0.
    key: "VERIFICATION_MIN_INLIERS",
    label: "Mínimo de inliers para puntuar (por debajo, puntuación 0)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_VERIFICATION_MIN_INLIERS),
  },
  {
    // The inlier count at which calibrate_score()'s inlier term maxes out at
    // 1.0. Lowering this makes it EASIER for weaker matches to score high
    // (saturates sooner); raising it demands more inliers to reach the same
    // score — this is the main knob for "everything still scores similarly
    // even after refining" (spec: real RoMa runs regularly produce inlier
    // counts in the thousands, so 3000 is a middle-of-the-road default, not
    // an extreme one — see verify.py's own calibration note).
    key: "VERIFICATION_INLIER_SATURATION",
    label: "Inliers para puntuación máxima de coincidencia",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_VERIFICATION_INLIER_SATURATION),
  },
  {
    // Reprojection error (px) at which calibrate_score()'s error term is
    // exactly 0.5 — smaller values punish imprecise homographies harder.
    key: "VERIFICATION_ERROR_SCALE_PX",
    label: "Escala de error de reproyección (px) — menor = más estricto",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_VERIFICATION_ERROR_SCALE_PX),
  },
  {
    // MAGSAC++'s own inlier/outlier pixel threshold when fitting the
    // homography — smaller values demand tighter geometric agreement to
    // even count a match as an inlier in the first place (upstream of the
    // score calibration above).
    key: "VERIFICATION_MAGSAC_THRESHOLD_PX",
    label: "Umbral MAGSAC++ (px) — menor = más estricto",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_VERIFICATION_MAGSAC_THRESHOLD_PX),
  },
  {
    key: "GOOGLE_FREE_MONTHLY_CREDIT_USD",
    label: "Google free monthly credit (USD, 0 = none)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0",
  },
  {
    key: "GOOGLE_FREE_MONTHLY_IMAGES",
    label: "Google free monthly Street View images (0 = none)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0",
  },
  {
    // Optional, opt-in (spec: user-facing setting, not a required prereq).
    // "wsl" routes the setup wizard's Install step through WSL2 instead of
    // native Windows for the inference venv/deps/weights — romatch disables
    // its optimized local-correlation kernel on non-Linux (confirmed live:
    // RoMa/Laila verification went from ~11-13s/candidate on Windows+CUDA to
    // a fraction of that once run under Linux), so this is purely a speed
    // knob, not a functional requirement. Installing WSL2 itself, and its
    // NVIDIA CUDA passthrough driver, is out of scope — this only assumes
    // WSL2 already exists on the host when set to "wsl" (see the wizard's
    // prereqs check).
    key: "INFERENCE_RUNTIME",
    label: "Where the inference service's dependencies were installed",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "windows",
    options: ["windows", "wsl"],
  },
];

export function getSettingDefinition(key: string): SettingDefinition {
  const def = SETTINGS_SCHEMA.find((s) => s.key === key);
  if (!def) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return def;
}

export function validateSettingValue(key: string, value: string): void {
  const def = getSettingDefinition(key);

  if (def.required && value.trim() === "") {
    throw new Error(`${def.label} is required`);
  }

  if (value.trim() === "") {
    return; // optional + empty is fine, nothing further to validate
  }

  if (def.type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`${def.label} must be a number`);
    }
    const allowZero = def.key.startsWith("GOOGLE_FREE_MONTHLY_");
    if (allowZero ? parsed < 0 : parsed <= 0) {
      throw new Error(`${def.label} must be ${allowZero ? "zero or greater" : "greater than 0"}`);
    }
  }

  if (def.type === "enum") {
    const options = def.options ?? [];
    if (!options.includes(value)) {
      throw new Error(`${def.label} must be one of: ${options.join(", ")}`);
    }
  }

  if (def.type === "slider") {
    const parsed = Number(value);
    const min = def.min ?? 1;
    const max = def.max ?? 10;
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      throw new Error(`${def.label} must be a number between ${min} and ${max}`);
    }
  }
}