// apps/web/app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { listActiveJobs } from "../../../lib/background-jobs";

// See apps/web/app/api/health/route.ts's identical comment — this route
// also has no request-derived inputs, so it needs the same explicit opt-out
// of build-time static prerendering (confirmed live: `next build` tried to
// prerender this route against the build-time DB, which doesn't have
// background_jobs yet).
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listActiveJobs(getPool());
  return NextResponse.json({ jobs });
}