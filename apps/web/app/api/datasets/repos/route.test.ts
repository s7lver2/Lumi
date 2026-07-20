import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({
  listUserRepositories: vi.fn(),
  getAuthenticatedLogin: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/datasets/repos", () => {
  it("400s when GITHUB_TOKEN isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("returns the authenticated login and repo list", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("gh-token") });

    const { listUserRepositories, getAuthenticatedLogin } = await import("../../../../lib/datasets/github");
    (getAuthenticatedLogin as any).mockResolvedValue("inigo");
    (listUserRepositories as any).mockResolvedValue([
      { owner: "inigo", repo: "lumi-madrid", private: false, description: null },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      login: "inigo",
      repos: [{ owner: "inigo", repo: "lumi-madrid", private: false, description: null }],
    });
  });
});