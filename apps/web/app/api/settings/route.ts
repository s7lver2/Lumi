// apps/web/app/api/settings/route.ts
import { NextResponse } from "next/server";
import {
  SETTINGS_SCHEMA,
  validateSettingValue,
  getSettingDefinition,
} from "@netryx/shared-types";
import { getSettingsRepo } from "../../../lib/settings-repo";
import { maskSecret } from "../../settings/mask";

const MASK = "••••••••";

// The GET below takes no request params, so Next's static-analysis treats it
// as eligible for build-time prerendering by default — it would freeze
// settings at whatever existed during the build (same fix as
// apps/web/app/api/health/route.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  const repo = getSettingsRepo();
  const result: Record<string, string> = {};
  for (const def of SETTINGS_SCHEMA) {
    const value = await repo.getSetting(def.key);
    if (value === null) continue;
    result[def.key] = def.isSecret ? maskSecret(value) : value;
  }
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const repo = getSettingsRepo();

  for (const [key, value] of Object.entries(body)) {
    let def;
    try {
      def = getSettingDefinition(key);
    } catch {
      return NextResponse.json(
        { error: `Unknown setting key: ${key}` },
        { status: 400 }
      );
    }

    try {
      validateSettingValue(key, value);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  for (const [key, value] of Object.entries(body)) {
    const def = getSettingDefinition(key);
    await repo.setSetting(key, value, def.isSecret);
  }

  return NextResponse.json({ ok: true });
}