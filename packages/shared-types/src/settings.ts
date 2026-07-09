// packages/shared-types/src/settings.ts
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

export type SettingType = "string" | "number" | "enum";

export interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  isSecret: boolean;
  required: boolean;
  defaultValue?: string;
  /** Required when type is "enum" — the set of values validateSettingValue accepts. */
  options?: string[];
}

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
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0.5",
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
    if (parsed <= 0) {
      throw new Error(`${def.label} must be greater than 0`);
    }
  }

  if (def.type === "enum") {
    const options = def.options ?? [];
    if (!options.includes(value)) {
      throw new Error(`${def.label} must be one of: ${options.join(", ")}`);
    }
  }
}