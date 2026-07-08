// apps/web/app/api/settings/route.ts
import { NextResponse } from "next/server";
import {
  SETTINGS_SCHEMA,
  validateSettingValue,
  getSettingDefinition,
} from "@netryx/shared-types";
import { getSettingsRepo } from "../../../lib/settings-repo";

const MASK = "••••••••";

export async function GET() {
  const repo = getSettingsRepo();
  const result: Record<string, string> = {};

  for (const def of SETTINGS_SCHEMA) {
    const value = await repo.getSetting(def.key);
    if (value === null) continue;
    result[def.key] = def.isSecret ? MASK : value;
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