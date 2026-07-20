// apps/web/lib/background-jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJob, completeJob, failJob, getJob, listActiveJobs, updateJobProgress } from "./background-jobs";

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

describe("updateJobProgress", () => {
  it("writes phase/current/total and bumps updated_at", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE background_jobs");
      expect(sql).toContain("progress_phase = $2");
      expect(params).toEqual(["job-1", "download", 4096, 65536]);
      return { rows: [] };
    });

    await updateJobProgress(pool, "job-1", "download", 4096, 65536);
  });

  it("accepts a null total for a phase whose size isn't known yet", async () => {
    const pool = makePool(async (sql, params) => {
      expect(params).toEqual(["job-1", "download", 4096, null]);
      return { rows: [] };
    });

    await updateJobProgress(pool, "job-1", "download", 4096, null);
  });
});

describe("getJob", () => {
  it("returns null when the job doesn't exist", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const job = await getJob(pool, "missing");
    expect(job).toBeNull();
  });

  it("maps a row to a BackgroundJob with no progress reported yet", async () => {
    const pool = makePool(async () => ({
      rows: [{
        id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
        error: null, result: { ok: true }, progress_phase: null, progress_current: null, progress_total: null,
        created_at: "2026-07-20T10:00:00.000Z", updated_at: "2026-07-20T10:00:01.000Z",
      }],
    }));

    const job = await getJob(pool, "job-1");
    expect(job).toEqual({
      id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
      error: null, result: { ok: true }, progress: null,
      createdAt: "2026-07-20T10:00:00.000Z", updatedAt: "2026-07-20T10:00:01.000Z",
    });
  });

  it("maps a row's progress fields into a BackgroundJobProgress", async () => {
    const pool = makePool(async () => ({
      rows: [{
        id: "job-1", kind: "dataset-install", label: "inigo/lumi-madrid@v1", status: "running",
        error: null, result: null, progress_phase: "extract", progress_current: 40, progress_total: 120,
        created_at: "2026-07-20T10:00:00.000Z", updated_at: "2026-07-20T10:00:01.000Z",
      }],
    }));

    const job = await getJob(pool, "job-1");
    expect(job?.progress).toEqual({ phase: "extract", current: 40, total: 120 });
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
          error: null, result: null, progress_phase: null, progress_current: null, progress_total: null,
          created_at: "2026-07-20T10:00:00.000Z", updated_at: "2026-07-20T10:00:00.000Z",
        }],
      };
    });

    const jobs = await listActiveJobs(pool);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job-1");
  });
});