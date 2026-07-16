// apps/web/app/api/model-catalog/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/model-catalog/github";
import { MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../lib/model-catalog/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";

export async function GET() {
  const activeVersion = RETRIEVAL_MODELS[0]?.version ?? null;
  const repos = await searchRepositoriesByTopic("lumi-model-catalog");

  const bundles = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const githubReleases = await listReleasesForRepo(owner, repo);

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          const encrypted = await downloadReleaseAsset(metadataAsset.url);
          const manifest = JSON.parse(decryptBuffer(encrypted, MODEL_CATALOG_SHARED_KEY).toString("utf8")) as ModelCatalogManifest;

          return {
            tag: release.tagName,
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
