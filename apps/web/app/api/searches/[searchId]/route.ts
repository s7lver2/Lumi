// apps/web/app/api/searches/[searchId]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getSearchResult } from "../../../../lib/search/get-search-result";

export async function GET(_request: Request, { params }: { params: { searchId: string } }) {
  const result = await getSearchResult(getPool(), params.searchId);
  if (!result) {
    return NextResponse.json({ error: "search not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
