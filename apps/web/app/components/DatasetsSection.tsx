// apps/web/app/components/DatasetsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenDatasetAreas, type DatasetArea, type DatasetCatalogItem } from "../lib/catalog-types";
import { DATASET_FILTERS, filterDatasetItems, type DatasetFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";
import { MismatchDialog } from "./MismatchDialog";
import { PublishWizard } from "./PublishWizard";
import { useBackgroundJobsStore } from "../stores/useBackgroundJobsStore";

function DatasetRow({ item, selected }: { item: DatasetCatalogItem; selected: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">{item.release.title}</div>
        <div className="text-[11px] text-subtle">{item.owner}/{item.repo} · {item.release.stats.pointsCaptured} puntos</div>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
          item.release.compatible
            ? "border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] text-[#8fd6a3]"
            : "border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.12)] text-warning-fg"
        }`}
      >
        {item.release.compatible ? "Compatible" : "Requiere completar embeddings"}
      </span>
    </div>
  );
}

export function DatasetsSection({ query }: { query: string }) {
  const [items, setItems] = useState<DatasetCatalogItem[]>([]);
  const [filter, setFilter] = useState<DatasetFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<DatasetCatalogItem | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const registerJob = useBackgroundJobsStore((s) => s.registerJob);
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!watchedJobId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await fetchJson<{ status: "running" | "done" | "failed" }>(`/api/jobs/${watchedJobId}`);
      if (cancelled || !data || data.status === "running") return;
      clearInterval(interval);
      setWatchedJobId(null);
      reload();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedJobId]);

  function reload() {
    fetchJson<{ areas: DatasetArea[] }>("/api/datasets").then((r) => setItems(flattenDatasetAreas(r.data?.areas ?? [])));
  }

  useEffect(reload, []);

  const q = query.toLowerCase();
  const filtered = filterDatasetItems(items, filter).filter(
    (item) =>
      item.release.title.toLowerCase().includes(q) ||
      item.repo.toLowerCase().includes(q) ||
      item.owner.toLowerCase().includes(q)
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function install(item: DatasetCatalogItem, forceInstall: boolean) {
    const { ok, data } = await fetchJson<{ jobId: string }>("/api/datasets/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag, forceInstall }),
    });
    if (!ok && (data as { compatible?: boolean } | null)?.compatible === false && !forceInstall) {
      setPendingInstall(item);
      return;
    }
    if (ok && data?.jobId) {
      registerJob(data.jobId);
      setWatchedJobId(data.jobId);
    } else {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo iniciar la instalación");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-white/10 px-3 py-2">
        <button
          onClick={() => setPublishOpen(true)}
          className="rounded-md border border-white/15 px-3 py-1.5 text-[11.5px] text-fg hover:bg-white/10"
        >
          + Publicar dataset
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[55%] border-r border-white/10">
          <CatalogList
            items={filtered}
            filters={[...DATASET_FILTERS]}
            activeFilter={filter}
            onFilterChange={(id) => setFilter(id as DatasetFilterId)}
            selectedId={selectedId}
            onSelect={(item) => setSelectedId(item.id)}
            renderRow={(item, sel) => <DatasetRow item={item} selected={sel} />}
          />
        </div>
        <div className="flex w-[45%] flex-col">
          {selected ? (
            <CatalogDetailPanel
              title={selected.release.title}
              subtitle={`github.com/${selected.owner}/${selected.repo} · ${selected.release.model.id} v${selected.release.model.version}`}
              stats={[
                { label: "Puntos", value: String(selected.release.stats.pointsCaptured) },
                { label: "Imágenes", value: String(selected.release.stats.imagesEmbedded) },
              ]}
              installLabel="Instalar"
              onInstall={() => install(selected, false)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-subtle">
              Selecciona un dataset para ver el detalle.
            </div>
          )}
          {status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}
        </div>
      </div>
      {pendingInstall && (
        <MismatchDialog
          release={pendingInstall.release}
          onCancel={() => setPendingInstall(null)}
          onConfirm={() => {
            const item = pendingInstall;
            setPendingInstall(null);
            install(item, true);
          }}
        />
      )}
      {publishOpen && (
        <PublishWizard
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}