// apps/web/lib/time-of-day.test.ts
import { describe, it, expect } from "vitest";
import { hourForLabel } from "./time-of-day";

describe("hourForLabel", () => {
  it("maps each of Wanda's four known time_of_day labels to a representative hour", () => {
    expect(hourForLabel("foto tomada al amanecer")).toBe(6);
    expect(hourForLabel("foto tomada al mediodía")).toBe(12.5);
    expect(hourForLabel("foto tomada al atardecer")).toBe(19);
    expect(hourForLabel("foto tomada de noche")).toBe(0);
  });

  it("returns null for an unrecognized label", () => {
    expect(hourForLabel("some future model's different wording")).toBeNull();
  });
});