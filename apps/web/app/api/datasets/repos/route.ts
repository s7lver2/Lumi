// apps/web/app/api/datasets/repos/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { listUserRepositories, getAuthenticatedLogin } from "../../../../lib/datasets/github";

// Reads settings from the DB at request time — must not be prerendered at
// build time (same fix as apps/web/app/api/health/route.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getSettingsRepo().getSetting("GITHUB_TOKEN");
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN no está configurado — configúralo en Ajustes primero" },
      { status: 400 }
    );
  }

  const [login, repos] = await Promise.all([getAuthenticatedLogin(token), listUserRepositories(token)]);
  return NextResponse.json({ login, repos });
}