// apps/web/app/api/datasets/route.ts
import { NextResponse } from "next/server";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/datasets/github";
import { getActiveModelTag } from "../../../lib/datasets/active-model";
import { isCompatible } from "../../../lib/datasets/compatibility";
import { METADATA_ASSET_NAME, type DatasetMetadata } from "../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../lib/datasets/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";

export async function GET() {
  const activeModel = await getActiveModelTag();
  const repos = await searchRepositoriesByTopic("lumi-dataset");

  const areas = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const githubReleases = await listReleasesForRepo(owner, repo);

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          const encrypted = await downloadReleaseAsset(metadataAsset.url);
          const metadata = JSON.parse(decryptBuffer(encrypted, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

          return {
            tag: release.tagName,
            title: metadata.title,
            description: metadata.description,
            model: metadata.model,
            stats: metadata.stats,
            compatible: isCompatible(metadata.model, activeModel),
          };
        })
      );

      return { owner, repo, releases: releases.filter((r): r is NonNullable<typeof r> => r !== null) };
    })
  );

  return NextResponse.json({ areas });
}
