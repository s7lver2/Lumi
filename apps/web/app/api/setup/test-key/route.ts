// apps/web/app/api/setup/test-key/route.ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { key } = (await request.json()) as { key?: string };
  if (!key) return NextResponse.json({ ok: false, error: "falta la API key" }, { status: 400 });
  // Street View metadata is a free endpoint; a well-formed key returns status OK/ZERO_RESULTS,
  // a bad key returns REQUEST_DENIED.
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=40.714,-73.998&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    const body = (await res.json()) as { status?: string; error_message?: string };
    const ok = body.status === "OK" || body.status === "ZERO_RESULTS";
    return NextResponse.json({ ok, status: body.status, error: body.error_message ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}