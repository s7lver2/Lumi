// apps/web/app/api/datasets/route.ts
import { NextResponse } from "next/server";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/datasets/github";
import { getActiveModelTag } from "../../../lib/datasets/active-model";
import { isCompatible } from "../../../lib/datasets/compatibility";
import { METADATA_ASSET_NAME, type DatasetMetadata } from "../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../lib/datasets/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";
import { getSettingsRepo } from "../../../lib/settings-repo";

export async function GET() {
  const activeModel = await getActiveModelTag();
  // Unauthenticated GitHub reads are capped at 60 req/hour — trivially
  // exhausted (confirmed live: every read 403'd after a burst of catalog
  // activity, same issue fixed for the model catalog). Using the
  // configured token, when present, raises that to 5000/hour; still works
  // read-only without one, just at the lower cap.
  const token = (await getSettingsRepo().getSetting("GITHUB_TOKEN")) ?? undefined;
  const repos = await searchRepositoriesByTopic("lumi-dataset", token);

  const areas = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      // A repo-level failure (rate limit, network hiccup, a repo that lost
      // read access) must not take down the whole catalog listing — same
      // fix as apps/web/app/api/model-catalog/route.ts.
      let githubReleases: Awaited<ReturnType<typeof listReleasesForRepo>>;
      try {
        githubReleases = await listReleasesForRepo(owner, repo, token);
      } catch (err) {
        console.error(`[datasets] skipping unreachable repo ${owner}/${repo}:`, err instanceof Error ? err.message : err);
        return { owner, repo, releases: [] };
      }

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          // A release that fails to download/decrypt/parse (wrong key,
          // corrupted asset, a repo mistagged with the "lumi-dataset" topic
          // that isn't actually a dataset release) must not take down the
          // whole catalog listing either — same fix as the model catalog's
          // GET route.
          let metadata: DatasetMetadata;
          try {
            const encrypted = await downloadReleaseAsset(metadataAsset.url, token);
            metadata = JSON.parse(decryptBuffer(encrypted, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;
          } catch (err) {
            console.error(
              `[datasets] skipping unreadable release ${owner}/${repo}#${release.tagName}:`,
              err instanceof Error ? err.message : err
            );
            return null;
          }

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
