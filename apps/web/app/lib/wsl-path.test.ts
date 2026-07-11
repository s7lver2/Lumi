// apps/web/app/lib/wsl-path.test.ts
import { describe, it, expect } from "vitest";
import { winPathToWsl } from "./wsl-path";

describe("winPathToWsl", () => {
  it("translates a backslash Windows path to its /mnt WSL equivalent", () => {
    expect(winPathToWsl("E:\\Lumi\\services\\inference")).toBe("/mnt/e/Lumi/services/inference");
  });

  it("lowercases the drive letter", () => {
    expect(winPathToWsl("C:\\Users\\nicke")).toBe("/mnt/c/Users/nicke");
  });

  it("handles forward slashes too", () => {
    expect(winPathToWsl("E:/Lumi/services/inference")).toBe("/mnt/e/Lumi/services/inference");
  });

  it("throws on a non-Windows-absolute path", () => {
    expect(() => winPathToWsl("services/inference")).toThrow(/Not an absolute Windows path/);
  });
});
