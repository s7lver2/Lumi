// apps/web/app/api/search/batch/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { addImage, resetLibraryForTests } from "../../../../lib/image-library";
import * as queueModule from "../../../../lib/queue";
import * as dbModule from "../../../../lib/db";

beforeEach(() => {
  resetLibraryForTests();
  vi.restoreAllMocks();
});

describe("POST /api/search/batch", () => {
  it("creates a search_batches row and enqueues the job", async () => {
    const image = addImage({
      bytes: Buffer.from("x"), filename: "a.png", mimeType: "image/png", width: 1, height: 1, sourceKind: "upload",
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.spyOn(dbModule, "getPool").mockReturnValue({ query } as never);
    const enqueue = vi.spyOn(queueModule, "enqueueAnalyzeImageBatchJob").mockResolvedValue("job-1");

    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ imageIds: [image.id], modelId: "lumi-preview" }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.batchId).toBeTruthy();
    expect(enqueue).toHaveBeenCalledWith({ batchId: body.batchId, imageIds: [image.id], modelId: "lumi-preview" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO search_batches"), expect.any(Array));
  });

  it("rejects a request with no imageIds", async () => {
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ imageIds: [], modelId: "lumi-preview" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });
});