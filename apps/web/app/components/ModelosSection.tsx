// apps/web/app/components/ModelosSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenModelBundles, type CatalogBundle, type ModelCatalogItem } from "../lib/catalog-types";
import { MODEL_FILTERS, filterModelItems, type ModelFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";

function ModelRow({ item, selected }: { item: ModelCatalogItem; selected: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">v{item.release.version}</div>
        <div className="text-[11px] text-subtle">{item.release.backbones.map((b) => b.name).join(" + ")}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
          {Math.round(item.release.benchmark.accuracyWithin50m * 100)}% ≤ 50m
        </span>
        {item.release.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
      </div>
    </div>
  );
}

export function ModelosSection({ query }: { query: string }) {
  const [items, setItems] = useState<ModelCatalogItem[]>([]);
  const [filter, setFilter] = useState<ModelFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uninstallInfo, setUninstallInfo] = useState<{ available: boolean; previousVersion: string | null }>({
    available: false,
    previousVersion: null,
  });
  const [uninstalling, setUninstalling] = useState(false);

  function refreshUninstallInfo() {
    fetchJson<{ available: boolean; previousVersion: string | null }>("/api/model-catalog/uninstall").then((r) => {
      if (r.data) setUninstallInfo(r.data);
    });
  }

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
    refreshUninstallInfo();
  }, []);

  const q = query.toLowerCase();
  const filtered = filterModelItems(items, filter).filter((item) => item.release.version.toLowerCase().includes(q));
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function install(item: ModelCatalogItem) {
    setStatus(`Instalando v${item.release.version}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setStatus(ok ? `Instalada v${item.release.version}` : (data as { error?: string } | null)?.error ?? "No se pudo instalar");
    refreshUninstallInfo();
  }

  async function uninstall() {
    setUninstalling(true);
    setStatus(
      uninstallInfo.previousVersion ? `Restaurando v${uninstallInfo.previousVersion}…` : "Restaurando estado original…"
    );
    const { ok, data } = await fetchJson<{ version: string | null }>("/api/model-catalog/uninstall", { method: "POST" });
    setStatus(
      ok
        ? data?.version
          ? `Restaurada v${data.version}`
          : "Restaurado el estado original"
        : (data as { error?: string } | null)?.error ?? "No se pudo desinstalar"
    );
    setUninstalling(false);
    refreshUninstallInfo();
  }

  return (
    <div className="flex h-full">
      <div className="w-[55%] border-r border-white/10">
        <CatalogList
          items={filtered}
          filters={[...MODEL_FILTERS]}
          activeFilter={filter}
          onFilterChange={(id) => setFilter(id as ModelFilterId)}
          selectedId={selectedId}
          onSelect={(item) => setSelectedId(item.id)}
          renderRow={(item, sel) => <ModelRow item={item} selected={sel} />}
        />
      </div>
      <div className="flex w-[45%] flex-col">
        {selected ? (
          <CatalogDetailPanel
            title={`Lumi Preview v${selected.release.version}`}
            subtitle={`github.com/${selected.owner}/${selected.repo}`}
            stats={[
              { label: "Precisión (≤50m)", value: `${Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%` },
              { label: "Distancia media", value: `${selected.release.benchmark.avgDistanceM.toFixed(1)}m` },
              { label: "Casos evaluados", value: String(selected.release.benchmark.sampleCount) },
            ]}
            extra={
              <div className="mt-4 space-y-1.5">
                {selected.release.backbones.map((b) => (
                  <div key={b.name} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                    <span>{b.name}</span>
                    <b className="text-fg">{b.source}</b>
                  </div>
                ))}
              </div>
            }
            installLabel={selected.release.isActive ? "Instalada" : "Instalar"}
            installDisabled={selected.release.isActive}
            onInstall={() => install(selected)}
            secondaryAction={
              selected.release.isActive
                ? {
                    label: uninstalling
                      ? "Desinstalando…"
                      : uninstallInfo.previousVersion
                        ? `Desinstalar (volver a v${uninstallInfo.previousVersion})`
                        : "Desinstalar",
                    onClick: uninstall,
                    disabled: uninstalling || !uninstallInfo.available,
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-subtle">
            Selecciona una versión para ver el detalle.
          </div>
        )}
        {status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}
      </div>
    </div>
  );
}
