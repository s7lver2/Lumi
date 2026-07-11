// apps/web/app/api/settings/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { maskSecret } from "../../settings/mask";
import { GET, PATCH } from "./route";

vi.mock("../../../lib/settings-repo", () => {
  const store = new Map<string, string>();
  return {
    getSettingsRepo: () => ({
      getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
      setSetting: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      isSetupCompleted: vi.fn(async () => store.get("__setup_completed__") === "true"),
      completeSetup: vi.fn(),
    }),
    __store: store,
  };
});

beforeEach(async () => {
  const mod: any = await import("../../../lib/settings-repo");
  mod.__store.clear();
});

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/settings", {
    method: body ? "PATCH" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/settings", () => {
  it("returns non-secret values and masks secret ones", async () => {
    const mod: any = await import("../../../lib/settings-repo");
    mod.__store.set("MAX_AREA_KM2", "5");
    mod.__store.set("GOOGLE_MAPS_API_KEY", "AIzaSyRealSecret");

    const res = await GET();
    const json = await res.json();

    expect(json.GOOGLE_MAPS_API_KEY).toBe(maskSecret("AIzaSyRealSecret"));
  });

  it("omits secret keys entirely when they are unset", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.GOOGLE_MAPS_API_KEY).toBeUndefined();
  });
});

describe("PATCH /api/settings", () => {
  it("rejects an invalid value with 400", async () => {
    const res = await PATCH(makeRequest({ MAX_AREA_KM2: "not-a-number" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/number/i);
  });

  it("persists a valid non-secret value and returns 200", async () => {
    const res = await PATCH(makeRequest({ MAX_AREA_KM2: "8" }));
    expect(res.status).toBe(200);

    const getRes = await GET();
    const json = await getRes.json();
    expect(json.MAX_AREA_KM2).toBe("8");
  });

  it("rejects an unknown setting key with 400", async () => {
    const res = await PATCH(makeRequest({ NOT_A_REAL_SETTING: "x" }));
    expect(res.status).toBe(400);
  });

  it("persists a valid RETRIEVAL_MODEL value (enum setting, spec §15.3)", async () => {
    const res = await PATCH(makeRequest({ RETRIEVAL_MODEL: "lumi-preview" }));
    expect(res.status).toBe(200);

    const getRes = await GET();
    const json = await getRes.json();
    expect(json.RETRIEVAL_MODEL).toBe("lumi-preview");
  });

  it("rejects a RETRIEVAL_MODEL value not in the registry with 400", async () => {
    const res = await PATCH(makeRequest({ RETRIEVAL_MODEL: "some-future-model" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/one of/i);
  });
});