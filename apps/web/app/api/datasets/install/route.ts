// apps/web/app/api/datasets/install/route.ts
import { NextResponse } from "next/server";
import { decryptBuffer } from "@netryx/settings-repo";
import { getPool } from "../../../../lib/db";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/datasets/github";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";
import { isCompatible } from "../../../../lib/datasets/compatibility";
import { BUNDLE_ASSET_NAME, METADATA_ASSET_NAME, type DatasetMetadata } from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { createJob } from "../../../../lib/background-jobs";
import { runDatasetInstallJob } from "./run-job";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
  forceInstall?: boolean;
}

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  const token = (await getSettingsRepo().getSetting("GITHUB_TOKEN")) ?? undefined;
  const releases = await listReleasesForRepo(body.owner, body.repo, token);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
  const bundleAsset = release.assets.find((a) => a.name === BUNDLE_ASSET_NAME);
  if (!metadataAsset || !bundleAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  let metadata: DatasetMetadata;
  let activeModel: Awaited<ReturnType<typeof getActiveModelTag>>;
  let compatible: boolean;
  try {
    const metadataBytes = await downloadReleaseAsset(metadataAsset.url, token);
    metadata = JSON.parse(decryptBuffer(metadataBytes, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

    activeModel = await getActiveModelTag();
    compatible = isCompatible(metadata.model, activeModel);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  if (!compatible && !body.forceInstall) {
    return NextResponse.json({ compatible: false, datasetModel: metadata.model, activeModel }, { status: 409 });
  }

  const pool = getPool();
  const jobId = await createJob(pool, "dataset-install", `${body.owner}/${body.repo}@${body.tag}`);
  void runDatasetInstallJob(pool, jobId, { bundleAssetUrl: bundleAsset.url, token, compatible });

  return NextResponse.json({ jobId }, { status: 202 });
}
