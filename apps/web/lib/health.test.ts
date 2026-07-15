import { describe, it, expect, vi, afterEach } from "vitest";
import { Pool } from "pg";
import { resolveServiceStatus, checkInferenceReady, checkWorkerHeartbeatFresh, fetchModelStatus } from "./health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveServiceStatus", () => {
  it("is ready when healthy right now, regardless of history", () => {
    expect(resolveServiceStatus(true, 1000, 2000, 500)).toBe("ready");
    expect(resolveServiceStatus(true, null, 2000, 500)).toBe("ready");
  });

  it("is loading when unhealthy but within the allowance, or with no start time yet", () => {
    expect(resolveServiceStatus(false, null, 2000, 90000)).toBe("loading");
    expect(resolveServiceStatus(false, 1000, 1500, 90000)).toBe("loading");
  });

  it("is crashed once unhealthy beyond the allowance", () => {
    expect(resolveServiceStatus(false, 1000, 92000, 90000)).toBe("crashed");
  });
});

describe("checkInferenceReady", () => {
  it("is true when /docs responds ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(true);
  });

  it("is false when /docs responds non-ok or the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await checkInferenceReady("http://localhost:8000")).toBe(false);
  });
});

describe("fetchModelStatus", () => {
  it("resolves with the inference service's /model-status body when it responds ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          loading: "retrieval",
          lowVramMode: true,
          gpuNote: "GPU detectada: RTX 3050 (6 GB)",
        }),
      })
    );
    expect(await fetchModelStatus("http://localhost:8000")).toEqual({
      loading: "retrieval",
      lowVramMode: true,
      gpuNote: "GPU detectada: RTX 3050 (6 GB)",
    });
  });

  it("falls back to loading: null, lowVramMode: false when the response is non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchModelStatus("http://localhost:8000")).toEqual({
      loading: null,
      lowVramMode: false,
      gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible.",
    });
  });

  it("falls back to loading: null, lowVramMode: false when the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await fetchModelStatus("http://localhost:8000")).toEqual({
      loading: null,
      lowVramMode: false,
      gpuNote: "Estado de la GPU desconocido — servicio de inferencia no disponible.",
    });
  });
});

describe("checkWorkerHeartbeatFresh", () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
  const pool = new Pool({ connectionString });

  it("is true when the heartbeat was touched recently", async () => {
    await pool.query("UPDATE worker_heartbeat SET updated_at = now() WHERE id = 1");
    expect(await checkWorkerHeartbeatFresh(pool, 15000)).toBe(true);
  });

  it("is false when the heartbeat is older than staleAfterMs", async () => {
    await pool.query("UPDATE worker_heartbeat SET updated_at = now() - interval '1 hour' WHERE id = 1");
    expect(await checkWorkerHeartbeatFresh(pool, 15000)).toBe(false);
    await pool.end();
  });
});
