// apps/web/app/api/settings/model-usage/rate/route.ts
import { NextResponse } from "next/server";
import { setModelUsageRate } from "@netryx/model-usage";
import { getPool } from "../../../../../lib/db";

export async function PATCH(request: Request) {
  let body: { kind?: unknown; rateUsdPerHour?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (typeof body.kind !== "string" || body.kind.length === 0) {
    return NextResponse.json({ error: "kind es obligatorio" }, { status: 400 });
  }
  if (typeof body.rateUsdPerHour !== "number" || !Number.isFinite(body.rateUsdPerHour) || body.rateUsdPerHour < 0) {
    return NextResponse.json({ error: "rateUsdPerHour debe ser un número >= 0" }, { status: 400 });
  }

  const pool = getPool();
  await setModelUsageRate(pool, body.kind, body.rateUsdPerHour);
  return NextResponse.json({ ok: true });
}
