// apps/web/app/api/search/[searchId]/refine/route.ts
import { NextResponse } from "next/server";
import { DEFAULT_CONFIRM_THRESHOLD, type RefineRequest } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { verifyCandidates } from "../../../../../lib/verify-client";
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
import { readImageBase64 } from "../../../../../lib/search/candidate-images";
import { persistRefine } from "../../../../../lib/search/refine-persist";
import { runRefine, type RunRefineDeps } from "../../../../../lib/search/run-refine";

export async function POST(
  request: Request,
  { params }: { params: { searchId: string } }
) {
  const body = (await request.json()) as RefineRequest;
  if (!body.regionId) {
    return NextResponse.json({ error: "regionId is required" }, { status: 400 });
  }

  const pool = getPool();
  const repo = getSettingsRepo();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const confirmThreshold = Number(
    (await repo.getSetting("VERIFICATION_CONFIRM_THRESHOLD")) ?? String(DEFAULT_CONFIRM_THRESHOLD)
  );

  const deps: RunRefineDeps = {
    confirmThreshold,
    getQueryImagePath: async (searchId) => {
      const { rows } = await pool.query(
        `SELECT query_image_path FROM searches WHERE id = $1`,
        [searchId]
      );
      if (rows.length === 0) throw new Error(`Search ${searchId} not found`);
      return rows[0].query_image_path as string;
    },
    expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
    readImage: (path) => readImageBase64(path),
    verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl),
    persist: (args) => persistRefine(pool, args),
  };

  try {
    const result = await runRefine(deps, { searchId: params.searchId, regionId: body.regionId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}