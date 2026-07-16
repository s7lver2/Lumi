// apps/web/app/api/searches/[searchId]/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/search/get-search-result", () => ({ getSearchResult: vi.fn() }));

describe("GET /api/searches/[searchId]", () => {
  it("404s when getSearchResult returns null", async () => {
    const { getSearchResult } = await import("../../../../lib/search/get-search-result");
    (getSearchResult as any).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/searches/missing"), { params: { searchId: "missing" } });
    expect(res.status).toBe(404);
  });

  it("returns the result JSON when found", async () => {
    const { getSearchResult } = await import("../../../../lib/search/get-search-result");
    (getSearchResult as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {} });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/searches/s1"), { params: { searchId: "s1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.searchId).toBe("s1");
  });
});
