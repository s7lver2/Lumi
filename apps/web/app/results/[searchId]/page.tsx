// apps/web/app/results/[searchId]/page.tsx
import { notFound } from "next/navigation";
import { getPool } from "../../../lib/db";
import { getSearchResult } from "../../../lib/search/get-search-result";
import { ResultsPageClient } from "../../components/ResultsPageClient";

export default async function ResultsPage({ params }: { params: { searchId: string } }) {
  // Calls the same read function GET /api/searches/[searchId] calls, rather
  // than fetching its own API over HTTP — ordinary Next.js practice
  // (avoids a same-process network hop); the property that actually
  // matters (no capability exists ONLY for this page) is preserved since
  // GET /api/searches/[searchId] independently exposes the exact same
  // data (spec's explicit architecture note).
  const result = await getSearchResult(getPool(), params.searchId);
  if (!result) notFound();

  return <ResultsPageClient initialResult={result} searchId={params.searchId} />;
}
