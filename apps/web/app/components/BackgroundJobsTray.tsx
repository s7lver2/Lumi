// apps/web/app/components/BackgroundJobsTray.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { useBackgroundJobsStore } from "../stores/useBackgroundJobsStore";

interface BackgroundJob {
  id: string;
  kind: "dataset-install" | "model-install" | "model-uninstall";
  label: string;
  status: "running" | "done" | "failed";
  error: string | null;
  result: unknown | null;
}

interface SearchBatch {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
}

const KIND_VERB: Record<BackgroundJob["kind"], string> = {
  "dataset-install": "Instalando dataset",
  "model-install": "Instalando",
  "model-uninstall": "Desinstalando",
};

function jobHeadline(job: BackgroundJob): string {
  if (job.status === "running") return `${KIND_VERB[job.kind]} ${job.label}…`;
  if (job.status === "done") return `${job.label}: listo`;
  return `${job.label}: ${job.error ?? "error"}`;
}

/**
 * Persistent bottom-right notification stack for background_jobs rows and
 * the current search batch, mounted once in AppShell (outside any route's
 * page tree) so it survives navigation between routes. Recovers active
 * work on mount by querying the server directly — no localStorage — since
 * background_jobs and search_batches are already the durable source of
 * truth for "is this still running" (spec: docs/superpowers/specs/
 * 2026-07-20-background-jobs-tray-design.md).
 */
export function BackgroundJobsTray() {
  const trackedIds = useBackgroundJobsStore((s) => s.trackedIds);
  const registerJob = useBackgroundJobsStore((s) => s.registerJob);
  const untrackJob = useBackgroundJobsStore((s) => s.untrackJob);
  const [jobs, setJobs] = useState<Record<string, BackgroundJob>>({});
  const [batch, setBatch] = useState<SearchBatch | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Recover whatever's already active on the server the moment this mounts
  // — including right after a reload, when trackedIds is empty because
  // this is a fresh client with no memory of what it started before.
  useEffect(() => {
    fetchJson<{ jobs: BackgroundJob[] }>("/api/jobs?active=true").then((r) => {
      for (const job of r.data?.jobs ?? []) registerJob(job.id);
    });
    fetchJson<{ batch: SearchBatch | null }>("/api/search/batch/active").then((r) => {
      if (r.data?.batch) setBatch(r.data.batch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (trackedIds.length === 0) return;
    let cancelled = false;

    async function poll() {
      for (const id of trackedIds) {
        const { data } = await fetchJson<BackgroundJob>(`/api/jobs/${id}`);
        if (cancelled || !data) continue;
        setJobs((prev) => ({ ...prev, [id]: data }));
      }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trackedIds]);

  useEffect(() => {
    if (!batch || batch.status === "done" || batch.status === "failed") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await fetchJson<SearchBatch>(`/api/search/batch/active`);
      if (!cancelled) setBatch(data ?? null);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batch]);

  const visibleJobs = trackedIds.map((id) => jobs[id]).filter((j): j is BackgroundJob => Boolean(j) && !dismissedIds.has(j.id));

  if (visibleJobs.length === 0 && !batch) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2">
      {visibleJobs.map((job) => (
        <div
          key={job.id}
          className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">{jobHeadline(job)}</div>
            {job.status === "running" && (
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
                <div
                  className="h-full w-2/5 rounded-full bg-fg/60"
                  style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
                />
              </div>
            )}
          </div>
          {job.status !== "running" && (
            <button
              onClick={() => {
                untrackJob(job.id);
                setDismissedIds((prev) => new Set(prev).add(job.id));
              }}
              className="text-subtle hover:text-fg"
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {batch && (
        <div className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">
              Escaneando {batch.done}/{batch.total}…
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
              <div
                className="h-full w-2/5 rounded-full bg-fg/60"
                style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}