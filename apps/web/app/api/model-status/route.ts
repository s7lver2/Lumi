import { NextResponse } from "next/server";

interface ModelStatus {
  loading: "retrieval" | "verification" | null;
  lowVramMode: boolean;
}

export async function GET() {
  const baseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${baseUrl}/model-status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`inference /model-status returned ${res.status}`);
    const body = (await res.json()) as ModelStatus;
    return NextResponse.json(body);
  } catch {
    // Unreachable inference service isn't this route's concern (the boot
    // health screen already covers that) — just report nothing is loading.
    return NextResponse.json({ loading: null, lowVramMode: false } satisfies ModelStatus);
  }
}
