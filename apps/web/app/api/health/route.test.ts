import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/health", () => ({
  checkInferenceReady: vi.fn(),
  checkWorkerHeartbeatFresh: vi.fn(),
  resolveServiceStatus: vi.fn((isHealthyNow: boolean) => (isHealthyNow ? "ready" : "loading")),
}));
vi.mock("../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("reports web as always ready, and worker/inference from the health checks", async () => {
    const health = await import("../../../lib/health");
    (health.checkInferenceReady as any).mockResolvedValue(true);
    (health.checkWorkerHeartbeatFresh as any).mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.web).toBe("ready");
    expect(json.inference).toBe("ready");
    expect(json.worker).toBe("loading");
  });
});
