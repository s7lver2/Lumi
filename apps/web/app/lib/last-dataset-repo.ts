// apps/web/app/lib/last-dataset-repo.ts

const STORAGE_KEY = "lumi:lastDatasetRepo";

export interface RepoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Remembers the last owner/repo the user published a dataset to, so the
 * publish wizard's destination step doesn't start empty every time
 * (spec's Non-goals: localStorage only, no server-side setting). An
 * injectable storage parameter — not a bare `localStorage` reference —
 * keeps this testable in the Node test environment, which has no
 * `window`; the real call site (PublishWizard.tsx) passes
 * `window.localStorage`. */
export function getLastDatasetRepo(storage: RepoStorage): string {
  return storage.getItem(STORAGE_KEY) ?? "";
}

export function setLastDatasetRepo(storage: RepoStorage, repo: string): void {
  storage.setItem(STORAGE_KEY, repo);
}
