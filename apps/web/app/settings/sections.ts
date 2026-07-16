// apps/web/app/settings/sections.ts
import { SETTINGS_SCHEMA, getSettingDefinition, type SettingDefinition } from "@netryx/shared-types";

export interface SettingsSection { id: string; title: string; keys: string[] }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "street-view", title: "Street View", keys: ["GOOGLE_MAPS_API_KEY"] },
  { id: "map", title: "Mapa", keys: ["MAPBOX_TOKEN"] },
  {
    id: "limits-cost",
    title: "Límites y coste",
    keys: [
      "MAX_AREA_KM2",
      "MAX_MONTHLY_BUDGET_USD",
      "MAX_CONCURRENT_REQUESTS",
      "STREET_VIEW_PRICE_PER_IMAGE_USD",
      "GOOGLE_FREE_MONTHLY_CREDIT_USD",
      "GOOGLE_FREE_MONTHLY_IMAGES",
    ],
  },
  {
    id: "models",
    title: "Modelos",
    keys: [
      "RETRIEVAL_MODEL",
      "VERIFICATION_MODEL",
      "VERIFICATION_CONFIRM_THRESHOLD",
      "VERIFICATION_TILE_PASSES",
      "VERIFICATION_MIN_INLIERS",
      "VERIFICATION_INLIER_SATURATION",
      "VERIFICATION_ERROR_SCALE_PX",
      "VERIFICATION_MAGSAC_THRESHOLD_PX",
      "INFERENCE_RUNTIME",
      "INFERENCE_LOW_VRAM_MODE",
      "GITHUB_TOKEN",
    ],
  },
];

/** Pairs each section with its definitions; throws if a schema key is unassigned. */
export function groupSettings(): { section: SettingsSection; defs: SettingDefinition[] }[] {
  const assigned = new Set(SETTINGS_SECTIONS.flatMap((s) => s.keys));
  const orphan = SETTINGS_SCHEMA.find((d) => !assigned.has(d.key));
  if (orphan) throw new Error(`Setting ${orphan.key} is not assigned to a section`);
  return SETTINGS_SECTIONS.map((section) => ({
    section,
    defs: section.keys.map((k) => getSettingDefinition(k)),
  }));
}