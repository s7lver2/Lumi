import { NextResponse } from "next/server";
import { fetchModelStatus } from "../../../lib/health";

// See apps/web/app/api/health/route.ts's identical comment — this route
// also has no request-derived inputs, so it needs the same explicit opt-out
// of build-time static prerendering.
export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const body = await fetchModelStatus(baseUrl);
  return NextResponse.json(body);
}
