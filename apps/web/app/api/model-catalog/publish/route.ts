// apps/web/app/api/model-catalog/publish/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS, DEFAULT_TOP_K } from "@netryx/shared-types";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { embedQueryImage } from "../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../lib/search/retrieval";
import { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } from "../../../../lib/model-catalog/benchmark";
import { buildInferenceCodeZip } from "../../../../lib/model-catalog/code-bundle";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/model-catalog/github";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { BUNDLE_CODE_ASSET_NAME, MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../../lib/model-catalog/manifest";
import { encryptBuffer } from "@netryx/settings-repo";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PublishBody {
  description?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  const repo = getSettingsRepo();
  const token = await repo.getSetting("GITHUB_TOKEN");
  const catalogRepo = await repo.getSetting("MODEL_CATALOG_REPO");
  if (!token || !catalogRepo) {
    return NextResponse.json({ error: "GITHUB_TOKEN and MODEL_CATALOG_REPO must be configured in Settings first" }, { status: 400 });
  }

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const cases = await buildReferenceSet(pool);
  const benchmark = await runBenchmark(cases, {
    readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
    embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl),
    retrieve: (embedding, excludeId) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K, excludeId),
  });

  if (!passesBenchmarkThreshold(benchmark)) {
    return NextResponse.json({ benchmark }, { status: 409 });
  }

  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";

  const inferenceDir = resolve(process.cwd(), "..", "services", "inference");
  const codeZip = await buildInferenceCodeZip(inferenceDir);

  const manifest: ModelCatalogManifest = {
    bundleId,
    version,
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark,
    description: body.description ?? "",
  };

  const [owner, repoName] = catalogRepo.split("/");
  const tag = `${bundleId}-v${version}`;
  const title = `${activeRetrievalModel?.displayName ?? "Lumi Preview"} v${version}`;

  await ensureRepoWithTopic(owner, repoName, token);
  await upsertRelease(
    owner,
    repoName,
    tag,
    title,
    [
      { name: BUNDLE_CODE_ASSET_NAME, data: encryptBuffer(Buffer.from(codeZip), MODEL_CATALOG_SHARED_KEY) },
      { name: MODEL_CATALOG_METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY) },
    ],
    token
  );

  return NextResponse.json({ tag, benchmark }, { status: 200 });
}
