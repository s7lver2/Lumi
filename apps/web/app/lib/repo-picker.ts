// apps/web/app/lib/repo-picker.ts

export interface RepoOption {
  owner: string;
  repo: string;
}

export interface RepoRow {
  kind: "existing" | "create";
  label: string;
  value: string;
}

/** Client-side substring filter over the fetched repo list — no live
 * GitHub search calls (spec Non-goals). */
export function filterRepos(repos: RepoOption[], query: string): RepoOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return repos;
  return repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(trimmed));
}

/** Existing-repo rows for whatever matches the query, plus — unless the
 * query is blank or exactly matches an existing repo — a trailing
 * "create new" row. New repos can only be created under the
 * authenticated login (GitHub's create-repo endpoint has no org
 * targeting), so a typed "owner/name" only keeps the part after the last
 * slash as the new repo's name; `login` always supplies the owner. */
export function buildRepoRows(repos: RepoOption[], query: string, login: string): RepoRow[] {
  const trimmed = query.trim();
  const matches = filterRepos(repos, trimmed);
  const rows: RepoRow[] = matches.map((r) => ({
    kind: "existing",
    label: `${r.owner}/${r.repo}`,
    value: `${r.owner}/${r.repo}`,
  }));

  if (trimmed.length === 0) return rows;

  const exactMatch = matches.some((r) => `${r.owner}/${r.repo}`.toLowerCase() === trimmed.toLowerCase());
  if (exactMatch) return rows;

  const name = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  if (name.length === 0) return rows;

  rows.push({
    kind: "create",
    label: `Crear repositorio nuevo "${name}" en tu cuenta`,
    value: `${login}/${name}`,
  });
  return rows;
}