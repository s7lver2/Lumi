// apps/web/lib/model-catalog/classification-models.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  installClassificationModel,
  uninstallClassificationModel,
  getClassificationModelHistory,
  listActiveClassificationModels,
} from "./classification-models";
import type { GenericClassifierManifest } from "./manifest";

function manifest(version: string): GenericClassifierManifest {
  return {
    kind: "generic-classifier",
    modelId: "wanda-v1",
    version,
    facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
    benchmark: { sampleCount: 0, ranAt: "2026-07-20T10:00:00.000Z", vramEstimateBytes: null },
    description: "",
  };
}

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("installClassificationModel", () => {
  it("inserts a new row for the model", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    await installClassificationModel(pool, manifest("1.0"));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO installed_classification_models"),
      ["wanda-v1", JSON.stringify(manifest("1.0"))]
    );
  });

  it("deactivates any existing active row for this modelId before inserting the new one — installing the same model twice must never leave two active rows at once", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    });

    await installClassificationModel(pool, manifest("1.0"));

    expect(calls[0].sql).toContain("UPDATE installed_classification_models SET active = false");
    expect(calls[0].params).toEqual(["wanda-v1"]);
    expect(calls[1].sql).toContain("INSERT INTO installed_classification_models");
  });
});

describe("uninstallClassificationModel", () => {
  it("deactivates the current row and reactivates the most recent row with a genuinely different version", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT manifest FROM installed_classification_models") && sql.includes("active = true")) {
        return { rows: [{ manifest: manifest("1.0") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) {
        return { rows: [{ id: "prev-row-id", manifest: manifest("0.9") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = true")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");

    expect(result).toEqual({ restoredVersion: "0.9" });
    expect(calls.some((c) => c.sql.includes("active = false"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("active = true"))).toBe(true);
    // the version(s) just deactivated must be excluded from the "find a
    // previous version" search, otherwise reactivating a row of the exact
    // same version would look like a rollback when it's actually a no-op
    const findPreviousCall = calls.find((c) => c.sql.includes("SELECT id, manifest"));
    expect(findPreviousCall?.params).toEqual(["wanda-v1", ["1.0"]]);
  });

  it("never reactivates a row of the same version that was just deactivated — repeated installs of the same version must fully uninstall, not silently reinstall themselves (confirmed live: wanda-v1 had 4 rows all at version 1.0 from repeated testing, and 'Desinstalar' kept reactivating another same-version row every time)", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT manifest FROM installed_classification_models") && sql.includes("active = true")) {
        return { rows: [{ manifest: manifest("1.0") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");

    expect(result).toEqual({ restoredVersion: null });
    const findPreviousCall = calls.find((c) => c.sql.includes("SELECT id, manifest"));
    expect(findPreviousCall?.params).toEqual(["wanda-v1", ["1.0"]]);
  });

  it("excludes every version that was active before this call, not just one — a data-integrity edge case from before installClassificationModel deactivated priors, where two rows were left active for the same modelId at different versions", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT manifest FROM installed_classification_models") && sql.includes("active = true")) {
        return { rows: [{ manifest: manifest("1.0") }, { manifest: manifest("1.1") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");

    expect(result).toEqual({ restoredVersion: null });
    const findPreviousCall = calls.find((c) => c.sql.includes("SELECT id, manifest"));
    expect(findPreviousCall?.params).toEqual(["wanda-v1", ["1.0", "1.1"]]);
  });

  it("returns restoredVersion: null when there's no earlier row to restore", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("SELECT manifest FROM installed_classification_models") && sql.includes("active = true")) {
        return { rows: [{ manifest: manifest("1.0") }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");
    expect(result).toEqual({ restoredVersion: null });
  });
});

describe("getClassificationModelHistory", () => {
  it("reports available: true with the previous version when one is deactivated most-recently-first", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("active = true")) return { rows: [{ manifest: manifest("1.0") }] };
      if (sql.includes("active = false")) return { rows: [{ manifest: manifest("0.9") }] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: true, previousVersion: "0.9" });
  });

  it("reports available: false when there's no active row for this model", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("active = true")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });
    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: false, previousVersion: null });
  });

  it("reports previousVersion: null when the only deactivated row is the same version that's currently active — a same-version rollback isn't a real previous version to offer", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("active = true")) return { rows: [{ manifest: manifest("1.0") }] };
      if (sql.includes("active = false")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });
    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: true, previousVersion: null });
  });
});

describe("listActiveClassificationModels", () => {
  it("returns every active row's manifest", async () => {
    const pool = makePool(async () => ({ rows: [{ manifest: manifest("1.0") }] }));
    const result = await listActiveClassificationModels(pool);
    expect(result).toEqual([manifest("1.0")]);
  });
});