// apps/web/app/lib/catalog-filters.ts
import type { DatasetCatalogItem, ModelCatalogItem } from "./catalog-types";

export const DATASET_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "compatible", label: "Compatibles" },
  { id: "incompatible", label: "No compatibles" },
] as const;

export type DatasetFilterId = (typeof DATASET_FILTERS)[number]["id"];

/** No "Instalados" filter here on purpose — dataset installs are additive
 * (you can install the same or a different area repeatedly), and
 * GET /api/datasets carries no "this exact release is already installed
 * locally" flag the way models' `isActive` does. Inventing one is a real
 * feature, out of scope for this UI-only redesign (spec's Data section). */
export function filterDatasetItems(items: DatasetCatalogItem[], filterId: DatasetFilterId): DatasetCatalogItem[] {
  if (filterId === "compatible") return items.filter((i) => i.release.compatible);
  if (filterId === "incompatible") return items.filter((i) => !i.release.compatible);
  return items;
}

export const MODEL_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Instalada" },
] as const;

export type ModelFilterId = (typeof MODEL_FILTERS)[number]["id"];

export function filterModelItems(items: ModelCatalogItem[], filterId: ModelFilterId): ModelCatalogItem[] {
  if (filterId === "active") return items.filter((i) => i.release.isActive);
  return items;
}
