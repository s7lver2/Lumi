// apps/web/app/components/ModelosSection.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { flattenModelBundles, type CatalogBundle, type ModelCatalogItem, type CatalogRelease } from "../lib/catalog-types";
import { MODEL_FILTERS, filterModelItems, type ModelFilterId } from "../lib/catalog-filters";
import { CatalogList } from "./CatalogList";
import { CatalogDetailPanel } from "./CatalogDetailPanel";
import { ModelLoadNotification } from "./ModelLoadNotification";

function ModelRow({ item, selected }: { item: ModelCatalogItem; selected: boolean }) {
  const r = item.release;
  return (
    <div className={`flex items-center justify-between border-b border-white/10 px-4 py-3 ${selected ? "bg-white/[.03]" : ""}`}>
      <div>
        <div className="text-[13px] text-fg">
          {r.kind === "code-bundle" ? `v${r.version}` : `${r.modelId}`}
        </div>
        <div className="text-[11px] text-subtle">
          {r.kind === "code-bundle" ? r.backbones.map((b) => b.name).join(" + ") : r.facets.map((f) => f.facet).join(", ")}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {r.kind === "code-bundle" && (
          <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
            {Math.round(r.benchmark.accuracyWithin50m * 100)}% ≤ 50m
          </span>
        )}
        {r.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
      </div>
    </div>
  );
}

interface UninstallInfo {
  available: boolean;
  previousVersion: string | null;
}

export function ModelosSection({ query }: { query: string }) {
  const [items, setItems] = useState<ModelCatalogItem[]>([]);
  const [filter, setFilter] = useState<ModelFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uninstallInfo, setUninstallInfo] = useState<UninstallInfo>({ available: false, previousVersion: null });
  const [uninstalling, setUninstalling] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [gpu, setGpu] = useState<{ freeBytes: number | null; totalBytes: number | null }>({ freeBytes: null, totalBytes: null });
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  function refreshUninstallInfo(release: CatalogRelease | null) {
    const qs = release?.kind === "generic-classifier" ? `?modelId=${encodeURIComponent(release.modelId)}` : "";
    fetchJson<UninstallInfo>(`/api/model-catalog/uninstall${qs}`).then((r) => {
      if (r.data) setUninstallInfo(r.data);
    });
  }

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
    fetchJson<{ gpuFreeBytes: number | null; gpuTotalBytes: number | null }>("/api/model-status").then((r) => {
      if (r.data) setGpu({ freeBytes: r.data.gpuFreeBytes, totalBytes: r.data.gpuTotalBytes });
    });
  }, []);

  const q = query.toLowerCase();
  const filtered = filterModelItems(items, filter).filter((item) => item.release.version.toLowerCase().includes(q));
  const selected = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    refreshUninstallInfo(selected?.release ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function install(item: ModelCatalogItem) {
    const label = item.release.kind === "code-bundle" ? `v${item.release.version}` : `${item.release.modelId} v${item.release.version}`;
    setInstalling(true);
    setStatus(`Instalando ${label}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setStatus(ok ? `Instalada ${label}` : (data as { error?: string } | null)?.error ?? "No se pudo instalar");
    setInstalling(false);
    refreshUninstallInfo(item.release);
  }

  async function uninstall() {
    if (!selected) return;
    const isClassifier = selected.release.kind === "generic-classifier";
    setUninstalling(true);
    setStatus(
      uninstallInfo.previousVersion ? `Restaurando v${uninstallInfo.previousVersion}…` : "Restaurando estado original…"
    );
    const { ok, data } = await fetchJson<{ version: string | null }>("/api/model-catalog/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isClassifier ? { modelId: (selected.release as { modelId: string }).modelId } : {}),
    });
    setStatus(
      ok
        ? data?.version
          ? `Restaurada v${data.version}`
          : "Restaurado el estado original"
        : (data as { error?: string } | null)?.error ?? "No se pudo desinstalar"
    );
    setUninstalling(false);
    refreshUninstallInfo(selected.release);
  }

  async function resetCatalog() {
    setResetting(true);
    setStatus("Restableciendo catálogo de modelos…");
    const { ok, data } = await fetchJson<{ error?: string }>("/api/model-catalog/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    setStatus(ok ? "Catálogo restablecido" : (data as { error?: string } | null)?.error ?? "No se pudo restablecer el catálogo");
    setResetting(false);
    setResetConfirmText("");
    if (ok) {
      fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setItems(flattenModelBundles(r.data?.bundles ?? [])));
      setSelectedId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
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
          selected.release.kind === "code-bundle" ? (
            <CatalogDetailPanel
              title={`Lumi Preview v${selected.release.version}`}
              subtitle={`github.com/${selected.owner}/${selected.repo}`}
              stats={
                selected.release.benchmark.benchmarkPending
                  ? [{ label: "Benchmarks", value: "Saldrán pronto" }]
                  : [
                      { label: "Precisión (≤50m)", value: `${Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%` },
                      { label: "Distancia media", value: `${selected.release.benchmark.avgDistanceM.toFixed(1)}m` },
                      { label: "Casos evaluados", value: String(selected.release.benchmark.sampleCount) },
                    ]
              }
              extra={
                <div className="mt-4 space-y-1.5">
                  {selected.release.benchmark.benchmarkPending && (
                    <div className="rounded-md border border-dashed border-white/20 bg-white/[.03] px-3 py-2 text-xs text-muted">
                      No se pudo correr el benchmark de precisión en esta máquina ahora mismo (probablemente por falta de
                      VRAM libre) — los benchmarks saldrán pronto.
                    </div>
                  )}
                  {selected.release.backbones.map((b) => (
                    <div key={b.name} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                      <span>{b.name}</span>
                      <b className="text-fg">{b.source}</b>
                    </div>
                  ))}
                  {selected.release.benchmark.vramEstimate && (
                    <>
                      <div className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                        <span>VRAM retrieval</span>
                        <b className="text-fg">
                          {selected.release.benchmark.vramEstimate.retrievalBytes !== null
                            ? `~${(selected.release.benchmark.vramEstimate.retrievalBytes / 1024 ** 3).toFixed(1)} GB`
                            : "—"}
                        </b>
                      </div>
                      <div className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                        <span>VRAM verificación</span>
                        <b className="text-fg">
                          {selected.release.benchmark.vramEstimate.verificationBytes !== null
                            ? `~${(selected.release.benchmark.vramEstimate.verificationBytes / 1024 ** 3).toFixed(1)} GB`
                            : "—"}
                        </b>
                      </div>
                    </>
                  )}
                </div>
              }
              vram={
                gpu.totalBytes !== null && gpu.freeBytes !== null
                  ? {
                      totalBytes: gpu.totalBytes,
                      freeBytes: gpu.freeBytes,
                      // The bar shows the heavier of the two models — in
                      // modo bajo-VRAM they never coexist (only one loaded
                      // at a time), so the bigger one is what actually
                      // determines whether this release fits; the exact
                      // breakdown is in the two rows above.
                      estimateBytes: Math.max(
                        selected.release.benchmark.vramEstimate?.retrievalBytes ?? 0,
                        selected.release.benchmark.vramEstimate?.verificationBytes ?? 0
                      ) || null,
                    }
                  : undefined
              }
              installLabel={
                selected.release.isActive
                  ? uninstallInfo.available
                    ? "Instalada"
                    : "Reinstalar (crear respaldo)"
                  : "Instalar"
              }
              // Matching the version string alone (isActive) doesn't mean a
              // real catalog install ever happened — a version set outside
              // this mechanism (e.g. a manual RETRIEVAL_MODEL setting from
              // before this release existed, confirmed live on this box:
              // set two days before lumi-preview-v1.0 was ever published)
              // leaves isActive true with no backup ever created, so
              // "Desinstalar" has nothing to restore to, permanently. Only
              // disable install once a real tracked backup exists
              // (uninstallInfo.available) — otherwise let a click through
              // to run the real install flow once, purely to establish
              // that backup going forward.
              installDisabled={selected.release.isActive && uninstallInfo.available}
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
            <CatalogDetailPanel
              title={`${selected.release.modelId} v${selected.release.version}`}
              subtitle={`github.com/${selected.owner}/${selected.repo}`}
              stats={[{ label: "Facetas", value: selected.release.facets.map((f) => f.facet).join(", ") }]}
              extra={
                <div className="mt-4 space-y-1.5">
                  {selected.release.facets.map((f) => (
                    <div key={f.facet} className="flex justify-between border-t border-white/10 py-1.5 text-xs text-muted">
                      <span>{f.facet}</span>
                      <b className="text-fg">{f.hfModelId}</b>
                    </div>
                  ))}
                </div>
              }
              vram={
                gpu.totalBytes !== null && gpu.freeBytes !== null
                  ? { totalBytes: gpu.totalBytes, freeBytes: gpu.freeBytes, estimateBytes: selected.release.benchmark.vramEstimateBytes }
                  : undefined
              }
              installLabel={selected.release.isActive ? "Instalado" : "Instalar"}
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
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-subtle">
            Selecciona una versión para ver el detalle.
          </div>
        )}
        {status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}
      </div>
      </div>
      <div className="w-full border-t border-white/10 bg-[rgba(163,51,51,0.04)] px-5 py-4">
        <div className="mb-1 text-xs font-medium text-danger-fg">Restablecer catálogo de modelos</div>
        <p className="mb-2 text-[11px] text-muted">
          Borra todo lo instalado (clasificadores y, si aplica, restaura el código de retrieval/verificación a su
          estado original) y reinicia el servicio de inferencia. Pensado para volver a un estado limpio antes de una
          demo o prueba — no se puede deshacer.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            placeholder='Escribe "RESET" para confirmar'
            className="w-56 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-fg outline-none focus:border-white/25"
          />
          <button
            onClick={resetCatalog}
            disabled={resetConfirmText !== "RESET" || resetting}
            className="rounded-md border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-3 py-1.5 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)] disabled:opacity-40"
          >
            {resetting ? "Restableciendo…" : "Restablecer catálogo de modelos"}
          </button>
        </div>
      </div>
      <ModelLoadNotification
        active={installing || uninstalling || resetting}
        fallbackLabel={installing ? "Instalando modelo…" : uninstalling ? "Desinstalando modelo…" : "Restableciendo catálogo…"}
      />
    </div>
  );
}
