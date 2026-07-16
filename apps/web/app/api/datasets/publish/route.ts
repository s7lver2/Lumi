// apps/web/app/api/datasets/publish/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";
import { buildAreasZip } from "../../../../lib/datasets/export-bundle";
import { buildDatasetMetadata, BUNDLE_ASSET_NAME, METADATA_ASSET_NAME } from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import { encryptBuffer } from "@netryx/settings-repo";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/datasets/github";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

interface PublishBody {
  areaId?: string;
  title?: string;
  description?: string;
  owner?: string;
  repo?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  if (!body.areaId || !body.title || !body.description || !body.owner || !body.repo) {
    return NextResponse.json({ error: "areaId, title, description, owner and repo are required" }, { status: 400 });
  }

  const token = await getSettingsRepo().getSetting("GITHUB_TOKEN");
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not configured — set it in Settings first" }, { status: 400 });
  }

  const model = await getActiveModelTag();
  const zipBytes = await buildAreasZip(getPool(), [body.areaId], model);

  const { rows } = await getPool().query(
    `SELECT points_captured, images_embedded FROM areas WHERE id = $1`,
    [body.areaId]
  );
  const stats = {
    pointsCaptured: rows[0]?.points_captured ?? 0,
    imagesEmbedded: rows[0]?.images_embedded ?? 0,
  };
  const metadata = buildDatasetMetadata(body.title, body.description, model, stats);

  const tag = `${model.id}-v${model.version}`;
  const displayName = RETRIEVAL_MODELS.find((m) => m.id === model.id)?.displayName ?? model.id;
  const title = `${displayName} v${model.version}`;

  await ensureRepoWithTopic(body.owner, body.repo, token);
  await upsertRelease(
    body.owner,
    body.repo,
    tag,
    title,
    [
      { name: BUNDLE_ASSET_NAME, data: encryptBuffer(Buffer.from(zipBytes), DATASET_SHARED_KEY) },
      { name: METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(metadata)), DATASET_SHARED_KEY) },
    ],
    token
  );

  return NextResponse.json({ tag }, { status: 200 });
}
