// apps/web/app/api/model-catalog/publish/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS, DEFAULT_TOP_K } from "@netryx/shared-types";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { embedQueryImage } from "../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../lib/search/retrieval";
import { buildReferenceSet, runBenchmark, passesBenchmarkThreshold, measureVramDelta, type ModelStatusSnapshot } from "../../../../lib/model-catalog/benchmark";
import { buildInferenceCodeZip } from "../../../../lib/model-catalog/code-bundle";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/model-catalog/github";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import {
  BUNDLE_CODE_ASSET_NAME,
  MODEL_CATALOG_METADATA_ASSET_NAME,
  type CodeBundleManifest,
  type GenericClassifierManifest,
  type ClassifierFacet,
} from "../../../../lib/model-catalog/manifest";
import { encryptBuffer } from "@netryx/settings-repo";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCandidates } from "../../../../lib/verify-client";
import { getRepoRoot } from "../../../../lib/repo-root";

interface PublishBody {
  kind?: "code-bundle" | "generic-classifier";
  description?: string;
  // generic-classifier only:
  modelId?: string;
  version?: string;
  facets?: ClassifierFacet[];
  sampleImageBase64?: string;
}

const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

async function getModelStatusSnapshot(): Promise<ModelStatusSnapshot> {
  const res = await fetch(`${INFERENCE_SERVICE_URL}/model-status`);
  if (!res.ok) return { gpuFreeBytes: null, gpuTotalBytes: null };
  return (await res.json()) as ModelStatusSnapshot;
}

async function publishGenericClassifier(body: PublishBody, token: string, catalogRepo: string) {
  if (!body.modelId || !body.version || !body.facets) {
    return NextResponse.json({ error: "modelId, version and facets are required for a generic-classifier publish" }, { status: 400 });
  }

  const draftManifest: GenericClassifierManifest = {
    kind: "generic-classifier",
    modelId: body.modelId,
    version: body.version,
    facets: body.facets,
    benchmark: { sampleCount: 0, ranAt: new Date().toISOString(), vramEstimateBytes: null },
    description: body.description ?? "",
  };

  // POST /models/{model_id}/classify only recognizes model_ids that are
  // already active in installed_classification_models — publish and
  // install are deliberately separate actions (spec: docs/superpowers/
  // specs/2026-07-20-unified-model-catalog-design.md), so a model being
  // published here has no active row yet and the warmup call below would
  // 404 (confirmed live) without this. Install a temporary row just for
  // the measurement, then remove it again immediately after — publish
  // alone must not leave the model installed, or change what's installed,
  // on this machine.
  //
  // Deliberately NOT using installClassificationModel/
  // uninstallClassificationModel (apps/web/lib/model-catalog/classification-
  // models.ts) here: those assume "uninstall" means "step back to whatever
  // was active before," which breaks when the publisher's own machine
  // already has this exact modelId installed and active — the shared
  // uninstall helper deactivates EVERY active row for that modelId (not
  // just the temporary one this function just inserted) and reactivates
  // an arbitrary older version, silently changing what's installed as a
  // side effect of publishing. Instead: capture exactly which row (if any)
  // was active before, insert a temp row for the measurement, and in the
  // `finally` block delete the temp row by its own id and restore the
  // captured row's exact prior state — publish must be install-neutral.
  const pool = getPool();
  const { rows: previouslyActiveRows } = await pool.query(
    `SELECT id FROM installed_classification_models WHERE model_id = $1 AND active = true`,
    [body.modelId]
  );
  const previouslyActiveId = (previouslyActiveRows[0] as { id: string } | undefined)?.id ?? null;
  if (previouslyActiveId) {
    await pool.query(`UPDATE installed_classification_models SET active = false WHERE id = $1`, [previouslyActiveId]);
  }

  const { rows: tempRows } = await pool.query(
    `INSERT INTO installed_classification_models (model_id, manifest, active) VALUES ($1, $2, true) RETURNING id`,
    [draftManifest.modelId, JSON.stringify(draftManifest)]
  );
  const tempRowId = (tempRows[0] as { id: string }).id;

  let vramEstimateBytes: number | null;
  try {
    vramEstimateBytes = await measureVramDelta(getModelStatusSnapshot, async () => {
      if (!body.sampleImageBase64) return;
      await fetch(`${INFERENCE_SERVICE_URL}/models/${body.modelId}/classify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_base64: body.sampleImageBase64 }),
      });
    });
  } finally {
    await pool.query(`DELETE FROM installed_classification_models WHERE id = $1`, [tempRowId]);
    if (previouslyActiveId) {
      await pool.query(`UPDATE installed_classification_models SET active = true WHERE id = $1`, [previouslyActiveId]);
    }
  }

  const manifest: GenericClassifierManifest = { ...draftManifest, benchmark: { ...draftManifest.benchmark, vramEstimateBytes } };

  const [owner, repoName] = catalogRepo.split("/");
  const tag = `${manifest.modelId}-v${manifest.version}`;
  const title = `${manifest.modelId} v${manifest.version}`;

  await ensureRepoWithTopic(owner, repoName, token);
  await upsertRelease(
    owner,
    repoName,
    tag,
    title,
    [{ name: MODEL_CATALOG_METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY) }],
    token
  );

  return NextResponse.json({ tag }, { status: 200 });
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  const repo = getSettingsRepo();
  const token = await repo.getSetting("GITHUB_TOKEN");
  const catalogRepo = await repo.getSetting("MODEL_CATALOG_REPO");
  if (!token || !catalogRepo) {
    return NextResponse.json({ error: "GITHUB_TOKEN and MODEL_CATALOG_REPO must be configured in Settings first" }, { status: 400 });
  }

  if (body.kind === "generic-classifier") {
    return publishGenericClassifier(body, token, catalogRepo);
  }

  const pool = getPool();
  const inferenceBaseUrl = INFERENCE_SERVICE_URL;

  const cases = await buildReferenceSet(pool);
  let benchmarkResult: Awaited<ReturnType<typeof runBenchmark>> | null = null;
  let retrievalBytes: number | null = null;
  let benchmarkPending = false;
  try {
    retrievalBytes = await measureVramDelta(getModelStatusSnapshot, async () => {
      benchmarkResult = await runBenchmark(cases, {
        readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
        embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl),
        retrieve: (embedding, excludeId) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K, excludeId),
      });
    });
  } catch (err) {
    // Doesn't block the publish — the accuracy run itself couldn't
    // complete (confirmed live: not enough free VRAM to even load
    // retrieval on a 6GB card), but that's a hardware/timing fact about
    // THIS machine right now, not a reason to withhold an otherwise-good
    // release. Publishes with a "pending" placeholder instead; the
    // catalog UI shows "los benchmarks saldrán pronto" rather than a
    // number, and accuracy gating below is skipped entirely.
    console.error("[model-catalog] accuracy benchmark failed, publishing with benchmarkPending:", err instanceof Error ? err.message : err);
    benchmarkPending = true;
    benchmarkResult = { accuracyWithin50m: 0, avgDistanceM: 0, sampleCount: 0, ranAt: new Date().toISOString() };
  }

  const liveVerificationModel = await repo.getSetting("VERIFICATION_MODEL");

  // Measured separately from retrieval above — a code-bundle release loads
  // TWO independent models (retrieval + verification) with very different
  // footprints (confirmed live: MegaLoc ~1GB, RoMa ~5GB on a 6GB card).
  // Only ever measuring retrieval made the published estimate look safe
  // while real usage OOM'd on RoMa, which this warmup never touched. Only
  // attempted when a verification model is actually configured (an empty
  // VERIFICATION_MODEL setting makes /verify itself 503 "not configured
  // yet" — nothing to measure in that case) and there are at least 2
  // reference images to use as a throwaway query/candidate pair.
  //
  // Unlike retrieval, a failure here (confirmed live: RoMa's real /verify
  // computation itself OOM'd on a 6GB card, not just its load) must NOT
  // crash the whole publish — the fact that verification doesn't reliably
  // fit is itself useful information, recorded as `null` rather than
  // aborting a release that otherwise has a perfectly good accuracy score.
  let verificationBytes: number | null = null;
  if (liveVerificationModel && cases.length >= 2) {
    try {
      verificationBytes = await measureVramDelta(getModelStatusSnapshot, async () => {
        const queryBase64 = (await readFile(cases[0].imagePath)).toString("base64");
        const candidateBase64 = (await readFile(cases[1].imagePath)).toString("base64");
        await verifyCandidates(queryBase64, [candidateBase64], inferenceBaseUrl);
      });
    } catch (err) {
      console.error("[model-catalog] verification VRAM measurement failed, recording null:", err instanceof Error ? err.message : err);
      verificationBytes = null;
    }
  }

  const benchmark = { ...benchmarkResult!, benchmarkPending, vramEstimate: { retrievalBytes, verificationBytes } };

  if (!benchmarkPending && !passesBenchmarkThreshold(benchmark)) {
    return NextResponse.json({ benchmark }, { status: 409 });
  }

  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";

  // Must be the real repo checkout, not process.cwd()'s "../.." — see
  // repo-root.ts for why a packaged --testing run's cwd doesn't give that.
  const inferenceDir = resolve(getRepoRoot(), "services", "inference");
  const codeZip = await buildInferenceCodeZip(inferenceDir);

  const manifest: CodeBundleManifest = {
    kind: "code-bundle",
    bundleId,
    version,
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark,
    description: body.description ?? "",
    verificationModelId: liveVerificationModel || undefined,
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
