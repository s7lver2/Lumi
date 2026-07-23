// apps/web/app/api/model-catalog/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/model-catalog/github";
import { MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../lib/model-catalog/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";
import { readUninstallMeta } from "../../../lib/model-catalog/uninstall-state";
import { listActiveClassificationModels } from "../../../lib/model-catalog/classification-models";
import { getPool } from "../../../lib/db";
import { getSettingsRepo } from "../../../lib/settings-repo";

// This route reads nothing from the request itself, so Next's static-analysis
// treats it as eligible for build-time prerendering by default — it would hit
// the DB/GitHub at build time instead of per-request (same fix as
// apps/web/app/api/health/route.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  // Falling back to the static constant when nothing has ever been
  // installed via the catalog keeps today's out-of-the-box behavior — a
  // fresh clone still shows its built-in version as "Activa" until the
  // first real catalog install.
  const { currentVersion } = await readUninstallMeta();
  const activeVersion = currentVersion ?? RETRIEVAL_MODELS[0]?.version ?? null;
  const activeClassifiers = await listActiveClassificationModels(getPool());
  // Unauthenticated GitHub reads are capped at 60 req/hour — trivially
  // exhausted (confirmed live: every read 403'd after a burst of catalog
  // activity). Using the configured token, when present, raises that to
  // 5000/hour; still works read-only without one, just at the lower cap.
  const token = (await getSettingsRepo().getSetting("GITHUB_TOKEN")) ?? undefined;
  const repos = await searchRepositoriesByTopic("lumi-model-catalog", token);

  const bundles = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      // A repo-level failure (rate limit, network hiccup, a repo that lost
      // read access) must not take down the whole catalog listing either —
      // same reasoning as the per-release try/catch below, just one layer
      // up (confirmed live: a rate-limited listReleasesForRepo call here
      // 500'd the entire response, hiding every other repo's releases too).
      let githubReleases: Awaited<ReturnType<typeof listReleasesForRepo>>;
      try {
        githubReleases = await listReleasesForRepo(owner, repo, token);
      } catch (err) {
        console.error(`[model-catalog] skipping unreachable repo ${owner}/${repo}:`, err instanceof Error ? err.message : err);
        return { owner, repo, releases: [] };
      }

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          // A release that fails to download/decrypt/parse (wrong key,
          // corrupted asset, a repo mistagged with the "lumi-model-catalog"
          // topic that isn't actually a model release) must not take down
          // the whole catalog listing — every other valid release would
          // vanish too, since this used to sit inside one un-guarded
          // Promise.all (confirmed live: a repo also tagged for the
          // dataset catalog threw on decryptBuffer here and the entire
          // GET /api/model-catalog response 500'd, hiding even the
          // perfectly valid lumi-preview release).
          let manifest: ModelCatalogManifest;
          try {
            const encrypted = await downloadReleaseAsset(metadataAsset.url, token);
            manifest = JSON.parse(decryptBuffer(encrypted, MODEL_CATALOG_SHARED_KEY).toString("utf8")) as ModelCatalogManifest;
          } catch (err) {
            console.error(
              `[model-catalog] skipping unreadable release ${owner}/${repo}#${release.tagName}:`,
              err instanceof Error ? err.message : err
            );
            return null;
          }

          if (manifest.kind === "generic-classifier") {
            const isActive = activeClassifiers.some((m) => m.modelId === manifest.modelId && m.version === manifest.version);
            return {
              tag: release.tagName,
              kind: "generic-classifier" as const,
              modelId: manifest.modelId,
              version: manifest.version,
              facets: manifest.facets,
              benchmark: manifest.benchmark,
              description: manifest.description,
              isActive,
            };
          }

          return {
            tag: release.tagName,
            kind: "code-bundle" as const,
            bundleId: manifest.bundleId,
            version: manifest.version,
            backbones: manifest.backbones,
            benchmark: manifest.benchmark,
            description: manifest.description,
            isActive: manifest.version === activeVersion,
          };
        })
      );

      return { owner, repo, releases: releases.filter((r): r is NonNullable<typeof r> => r !== null) };
    })
  );

  return NextResponse.json({ bundles });
}
