// apps/web/app/stores/useBackgroundJobsStore.ts
import { create } from "zustand";

interface BackgroundJobsState {
  trackedIds: string[];
  registerJob: (jobId: string) => void;
  untrackJob: (jobId: string) => void;
}

/** Just the set of job ids the tray should be polling — the tray itself
 * owns each job's actual status/label/result, fetched from the server.
 * Kept separate from BackgroundJobsTray so ModelosSection/DatasetsSection
 * can register a freshly created job without needing to import the tray
 * component itself (matches useIndexingStore's separation from
 * JobProgressBar). */
export const useBackgroundJobsStore = create<BackgroundJobsState>((set) => ({
  trackedIds: [],
  registerJob: (jobId) => set((s) => (s.trackedIds.includes(jobId) ? s : { trackedIds: [...s.trackedIds, jobId] })),
  untrackJob: (jobId) => set((s) => ({ trackedIds: s.trackedIds.filter((id) => id !== jobId) })),
}));