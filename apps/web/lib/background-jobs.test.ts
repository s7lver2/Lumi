// apps/web/lib/background-jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJob, completeJob, failJob, getJob, listActiveJobs } from "./background-jobs";

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("createJob", () => {
  it("inserts a running job row and returns its id", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("INSERT INTO background_jobs");
      expect(params).toEqual(["model-install", "Wanda v1.0"]);
      return { rows: [{ id: "job-1" }] };
    });

    const id = await createJob(pool, "model-install", "Wanda v1.0");
    expect(id).toBe("job-1");
  });
});

describe("completeJob", () => {
  it("sets status done, stores the result, and bumps updated_at", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE background_jobs");
      expect(sql).toContain("status = 'done'");
      expect(params).toEqual(["job-1", JSON.stringify({ ok: true, version: "1.0" })]);
      return { rows: [] };
    });

    await completeJob(pool, "job-1", { ok: true, version: "1.0" });
  });
});

describe("failJob", () => {
  it("sets status failed and stores the error message", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE background_jobs");
      expect(sql).toContain("status = 'failed'");
      expect(params).toEqual(["job-1", "disk full"]);
      return { rows: [] };
    });

    await failJob(pool, "job-1", "disk full");
  });
});

describe("getJob", () => {
  it("returns null when the job doesn't exist", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const job = await getJob(pool, "missing");
    expect(job).toBeNull();
  });

  it("maps a row to a BackgroundJob", async () => {
    const pool = makePool(async () => ({
      rows: [{
        id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
        error: null, result: { ok: true }, created_at: "2026-07-20T10:00:00.000Z",
        updated_at: "2026-07-20T10:00:01.000Z",
      }],
    }));

    const job = await getJob(pool, "job-1");
    expect(job).toEqual({
      id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
      error: null, result: { ok: true }, createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:01.000Z",
    });
  });
});

describe("listActiveJobs", () => {
  it("selects running jobs or ones finished within the last 15 seconds", async () => {
    const pool = makePool(async (sql) => {
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain("interval '15 seconds'");
      return {
        rows: [{
          id: "job-1", kind: "dataset-install", label: "inigo/lumi-madrid@v1", status: "running",
          error: null, result: null, created_at: "2026-07-20T10:00:00.000Z",
          updated_at: "2026-07-20T10:00:00.000Z",
        }],
      };
    });

    const jobs = await listActiveJobs(pool);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job-1");
  });
});