import { describe, it, expect } from "vitest";
import { getLastDatasetRepo, setLastDatasetRepo, type RepoStorage } from "./last-dataset-repo";

function makeFakeStorage(): RepoStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("getLastDatasetRepo", () => {
  it("returns an empty string when nothing was ever saved", () => {
    expect(getLastDatasetRepo(makeFakeStorage())).toBe("");
  });

  it("returns whatever was saved by setLastDatasetRepo", () => {
    const storage = makeFakeStorage();
    setLastDatasetRepo(storage, "inigo/lumi-madrid");
    expect(getLastDatasetRepo(storage)).toBe("inigo/lumi-madrid");
  });
});
