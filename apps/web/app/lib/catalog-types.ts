// apps/web/app/lib/catalog-types.ts

export interface ModelTag { id: string; version: string; embeddingDim: number }

export interface DatasetRelease {
  tag: string;
  title: string;
  description: string;
  model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number };
  compatible: boolean;
}

export interface DatasetArea { owner: string; repo: string; releases: DatasetRelease[] }

export interface DatasetCatalogItem {
  id: string;
  owner: string;
  repo: string;
  release: DatasetRelease;
}

export interface Backbone { name: string; source: string }

export interface CatalogBenchmark {
  accuracyWithin50m: number;
  avgDistanceM: number;
  sampleCount: number;
  ranAt: string;
}

export interface CatalogRelease {
  tag: string;
  bundleId: string;
  version: string;
  backbones: Backbone[];
  benchmark: CatalogBenchmark;
  description: string;
  isActive: boolean;
}

export interface CatalogBundle { owner: string; repo: string; releases: CatalogRelease[] }

export interface ModelCatalogItem {
  id: string;
  owner: string;
  repo: string;
  release: CatalogRelease;
}

/** Flattens the grouped-by-repo API response into one row per release — the
 * Factorio-style list shows one row per item, not a card per repo (spec:
 * docs/superpowers/specs/2026-07-17-catalog-browser-redesign-design.md). */
export function flattenDatasetAreas(areas: DatasetArea[]): DatasetCatalogItem[] {
  return areas.flatMap((area) =>
    area.releases.map((release) => ({
      id: `${area.owner}/${area.repo}#${release.tag}`,
      owner: area.owner,
      repo: area.repo,
      release,
    }))
  );
}

export function flattenModelBundles(bundles: CatalogBundle[]): ModelCatalogItem[] {
  return bundles.flatMap((bundle) =>
    bundle.releases.map((release) => ({
      id: `${bundle.owner}/${bundle.repo}#${release.tag}`,
      owner: bundle.owner,
      repo: bundle.repo,
      release,
    }))
  );
}
