import { NextResponse } from "next/server";
import { fetchModelStatus } from "../../../lib/health";

export async function GET() {
  const baseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const body = await fetchModelStatus(baseUrl);
  return NextResponse.json(body);
}
