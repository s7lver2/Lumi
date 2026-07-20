// apps/web/app/api/model-catalog/install/route.ts
import { NextResponse } from "next/server";
import { decryptBuffer } from "@netryx/settings-repo";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import {
  validateModelCatalogManifest,
  BUNDLE_CODE_ASSET_NAME,
  MODEL_CATALOG_METADATA_ASSET_NAME,
} from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { getPool } from "../../../../lib/db";
import { createJob } from "../../../../lib/background-jobs";
import { runModelInstallJob } from "./run-job";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  const releases = await listReleasesForRepo(body.owner, body.repo);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
  if (!metadataAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  if (manifest.kind !== "generic-classifier") {
    const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
    if (!codeAsset) {
      return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
    }
  }

  const pool = getPool();
  const label =
    manifest.kind === "generic-classifier" ? `${manifest.modelId} v${manifest.version}` : `Lumi Preview v${manifest.version}`;
  const jobId = await createJob(pool, "model-install", label);

  const codeAssetUrl =
    manifest.kind === "generic-classifier"
      ? undefined
      : release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME)?.url;
  const origin = new URL(request.url).origin;
  void runModelInstallJob(pool, jobId, { manifest, codeAssetUrl, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}
