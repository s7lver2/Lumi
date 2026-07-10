// apps/web/app/settings/sections.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "@netryx/shared-types";
import { groupSettings, SETTINGS_SECTIONS } from "./sections";

describe("settings sections", () => {
  it("assigns every schema key to exactly one section", () => {
    const keys = SETTINGS_SECTIONS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    expect([...keys].sort()).toEqual(SETTINGS_SCHEMA.map((d) => d.key).sort());
  });
  it("groupSettings returns one entry per section with resolved defs", () => {
    const groups = groupSettings();
    expect(groups.map((g) => g.section.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
    for (const g of groups) expect(g.defs.length).toBe(g.section.keys.length);
  });
});