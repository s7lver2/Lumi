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
  it("deactivates the current row and reactivates the immediately-preceding one", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT id FROM installed_classification_models")) {
        return { rows: [{ id: "active-row-id" }] };
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
    // the row about to be deactivated must be excluded from the "find a
    // previous version" search, otherwise a model with no other history
    // would match its own just-deactivated row and immediately reactivate it
    const findPreviousCall = calls.find((c) => c.sql.includes("SELECT id, manifest"));
    expect(findPreviousCall?.params).toEqual(["wanda-v1", ["active-row-id"]]);
  });

  it("excludes every row that was active before this call from the previous-version search, not just one — a data-integrity edge case from before installClassificationModel deactivated priors, where two rows were left active for the same modelId (confirmed live: a single-id exclusion let the query match and immediately reactivate the OTHER row this same call had just deactivated)", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = makePool(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT id FROM installed_classification_models")) {
        return { rows: [{ id: "active-row-1" }, { id: "active-row-2" }] };
      }
      if (sql.includes("UPDATE installed_classification_models SET active = false")) return { rows: [] };
      if (sql.includes("SELECT id, manifest")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await uninstallClassificationModel(pool, "wanda-v1");

    expect(result).toEqual({ restoredVersion: null });
    const findPreviousCall = calls.find((c) => c.sql.includes("SELECT id, manifest"));
    expect(findPreviousCall?.params).toEqual(["wanda-v1", ["active-row-1", "active-row-2"]]);
  });

  it("returns restoredVersion: null when there's no earlier row to restore", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("SELECT id FROM installed_classification_models")) return { rows: [{ id: "active-row-id" }] };
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
      if (sql.includes("SELECT 1 FROM installed_classification_models")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (sql.includes("SELECT manifest FROM installed_classification_models")) {
        return { rows: [{ manifest: manifest("0.9") }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: true, previousVersion: "0.9" });
  });

  it("reports available: false when there's no active row for this model", async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes("SELECT 1 FROM installed_classification_models")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });
    const result = await getClassificationModelHistory(pool, "wanda-v1");
    expect(result).toEqual({ available: false, previousVersion: null });
  });
});

describe("listActiveClassificationModels", () => {
  it("returns every active row's manifest", async () => {
    const pool = makePool(async () => ({ rows: [{ manifest: manifest("1.0") }] }));
    const result = await listActiveClassificationModels(pool);
    expect(result).toEqual([manifest("1.0")]);
  });
});