// apps/web/lib/datasets/export-bundle.test.ts
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { buildAreasZip } from "./export-bundle";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockRejectedValue(new Error("no file on disk")) }));

function makePool(areaRows: any[], imageRows: any[], pointRows: any[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM areas")) return { rows: areaRows };
      if (sql.includes("FROM indexed_images")) return { rows: imageRows };
      if (sql.includes("FROM indexed_points")) return { rows: pointRows };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

describe("buildAreasZip", () => {
  it("includes a model tag in manifest.json alongside the existing area/image/point shape", async () => {
    const pool = makePool(
      [{ id: "a1", name: "Test", geometry_wkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", area_km2: "1", status: "indexed", points_estimated: 1, points_captured: 1, points_failed: 0, images_embedded: 1, estimated_cost_usd: null, actual_cost_usd: null }],
      [{ pano_id: "abc", heading: 0, lat: "0", lng: "0", street_view_date: null, embedding_text: "[0.1,0.2]", image_path: null }],
      [{ pano_id: "abc", lat: "0", lng: "0", embedding_text: "[0.1,0.2]" }]
    );
    const model = { id: "lumi-preview", version: "1.0", embeddingDim: 2 };

    const zipBytes = await buildAreasZip(pool, ["a1"], model);
    const zip = await JSZip.loadAsync(zipBytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));

    expect(manifest.model).toEqual(model);
    expect(manifest.areas).toHaveLength(1);
    expect(manifest.areas[0].images[0].panoId).toBe("abc");
  });
});
