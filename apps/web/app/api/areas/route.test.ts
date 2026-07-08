// apps/web/app/api/areas/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@netryx/geo-sampling", () => ({
  fetchStreetGeometry: vi.fn().mockResolvedValue([
    { type: "LineString", coordinates: [[0, 0], [0, 0.001]] },
  ]),
  samplePointsAlongStreets: vi.fn().mockReturnValue(
    Array.from({ length: 100 }, (_, i) => ({ lat: i, lng: 0 }))
  ),
  estimateIndexingCostUsd: vi.fn().mockReturnValue(2.8),
  assertAreaWithinSizeLimit: vi.fn(),
}));

vi.mock("../../../lib/settings-repo", () => ({
  getSettingsRepo: () => ({
    getSetting: vi.fn(async (key: string) => {
      const values: Record<string, string> = {
        MAX_AREA_KM2: "5",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
      };
      return values[key] ?? null;
    }),
  }),
}));

const insertedAreas: any[] = [];
const enqueuedJobs: any[] = [];

vi.mock("../../../lib/db", () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("INSERT INTO areas")) {
        const row = { id: "generated-area-id", ...params };
        insertedAreas.push(row);
        return { rows: [{ id: "generated-area-id" }] };
      }
      if (sql.includes("SELECT") && sql.includes("FROM areas")) {
        return { rows: insertedAreas };
      }
      return { rows: [] };
    }),
  }),
}));

vi.mock("../../../lib/queue", () => ({
  enqueueIndexAreaJob: vi.fn(async (payload: any) => {
    enqueuedJobs.push(payload);
    return "job-1";
  }),
}));

import { POST, GET } from "./route";

beforeEach(() => {
  insertedAreas.length = 0;
  enqueuedJobs.length = 0;
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/areas", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/areas", () => {
  const validPolygon = [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]];

  it("rejects a polygon whose area exceeds MAX_AREA_KM2", async () => {
    const geoSampling = await import("@netryx/geo-sampling");
    (geoSampling.assertAreaWithinSizeLimit as any).mockImplementationOnce(() => {
      throw new Error("Area of 12 km² exceeds the configured limit of 5 km²");
    });

    const res = await POST(makeRequest({ polygon: validPolygon, areaKm2: 12 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/exceeds the configured limit/);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("creates the area row with an estimated cost and enqueues the indexing job", async () => {
    const res = await POST(makeRequest({ polygon: validPolygon, areaKm2: 2, name: "Test area" }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.areaId).toBe("generated-area-id");
    expect(json.estimatedCostUsd).toBe(2.8);
    expect(json.pointsEstimated).toBe(100);

    expect(enqueuedJobs).toEqual([{ areaId: "generated-area-id" }]);
  });

  it("rejects a request missing polygon", async () => {
    const res = await POST(makeRequest({ areaKm2: 2 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/areas", () => {
  it("returns 200 with an (empty) list", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.areas)).toBe(true);
  });
});