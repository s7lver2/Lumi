// apps/web/app/lib/repo-picker.test.ts
import { describe, it, expect } from "vitest";
import { filterRepos, buildRepoRows } from "./repo-picker";

const REPOS = [
  { owner: "inigo", repo: "lumi-madrid" },
  { owner: "inigo", repo: "lumi-sevilla" },
  { owner: "some-org", repo: "other-project" },
];

describe("filterRepos", () => {
  it("returns everything when the query is blank", () => {
    expect(filterRepos(REPOS, "")).toEqual(REPOS);
    expect(filterRepos(REPOS, "   ")).toEqual(REPOS);
  });

  it("matches owner/repo as a case-insensitive substring", () => {
    expect(filterRepos(REPOS, "madrid")).toEqual([{ owner: "inigo", repo: "lumi-madrid" }]);
    expect(filterRepos(REPOS, "INIGO/LUMI")).toEqual([
      { owner: "inigo", repo: "lumi-madrid" },
      { owner: "inigo", repo: "lumi-sevilla" },
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterRepos(REPOS, "nonexistent")).toEqual([]);
  });
});

describe("buildRepoRows", () => {
  it("renders one existing row per match, no create row, when the query is blank", () => {
    const rows = buildRepoRows(REPOS, "", "inigo");
    expect(rows).toEqual([
      { kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" },
      { kind: "existing", label: "inigo/lumi-sevilla", value: "inigo/lumi-sevilla" },
      { kind: "existing", label: "some-org/other-project", value: "some-org/other-project" },
    ]);
  });

  it("omits the create row when the query exactly matches an existing repo", () => {
    const rows = buildRepoRows(REPOS, "inigo/lumi-madrid", "inigo");
    expect(rows).toEqual([{ kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" }]);
  });

  it("appends a create-new row under the authenticated login when nothing matches", () => {
    const rows = buildRepoRows(REPOS, "brand-new-repo", "inigo");
    expect(rows).toEqual([
      { kind: "create", label: 'Crear repositorio nuevo "brand-new-repo" en tu cuenta', value: "inigo/brand-new-repo" },
    ]);
  });

  it("uses only the text after the last slash as the new repo's name, ignoring any typed owner", () => {
    const rows = buildRepoRows(REPOS, "someorg/brand-new-repo", "inigo");
    expect(rows).toEqual([
      { kind: "create", label: 'Crear repositorio nuevo "brand-new-repo" en tu cuenta', value: "inigo/brand-new-repo" },
    ]);
  });

  it("shows partial matches alongside the create row when no existing repo is an exact match", () => {
    const rows = buildRepoRows(REPOS, "lumi", "inigo");
    expect(rows).toEqual([
      { kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" },
      { kind: "existing", label: "inigo/lumi-sevilla", value: "inigo/lumi-sevilla" },
      { kind: "create", label: 'Crear repositorio nuevo "lumi" en tu cuenta', value: "inigo/lumi" },
    ]);
  });
});