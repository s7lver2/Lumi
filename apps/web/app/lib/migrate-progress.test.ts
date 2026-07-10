// apps/web/app/lib/migrate-progress.test.ts
import { describe, it, expect } from "vitest";
import { appliedMigrations, migrateProgress } from "./migrate-progress";

const LINES = [
  "> Migrating files:",
  "> - 1720400000000_init",           // listing line, must NOT count
  "### MIGRATION 1720400000000_init (UP) ###",
  "CREATE EXTENSION IF NOT EXISTS vector;",
  "### MIGRATION 1720400100000_add_points_failed (UP) ###",
];

describe("migrate-progress", () => {
  it("counts only applied migrations, deduped", () => {
    expect(appliedMigrations(LINES)).toEqual([
      "1720400000000_init",
      "1720400100000_add_points_failed",
    ]);
  });
  it("computes fraction against a known total", () => {
    const p = migrateProgress(LINES, 5);
    expect(p.applied).toBe(2);
    expect(p.total).toBe(5);
    expect(p.fraction).toBeCloseTo(0.4);
  });
  it("clamps applied to total", () => {
    expect(migrateProgress(LINES, 1).applied).toBe(1);
  });
});