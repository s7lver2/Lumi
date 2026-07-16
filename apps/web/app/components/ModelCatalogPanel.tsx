// apps/web/app/components/ModelCatalogPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { fetchJson } from "../lib/fetch-json";

interface Backbone { name: string; source: string }
interface CatalogBenchmark { accuracyWithin50m: number; avgDistanceM: number; sampleCount: number; ranAt: string }
interface CatalogRelease {
  tag: string; bundleId: string; version: string; backbones: Backbone[];
  benchmark: CatalogBenchmark; description: string; isActive: boolean;
}
interface CatalogBundle { owner: string; repo: string; releases: CatalogRelease[] }

function ReleaseRow({
  owner, repo, release, selected, onSelect, onInstall,
}: { owner: string; repo: string; release: CatalogRelease; selected: boolean; onSelect: () => void; onInstall: () => void }) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center justify-between border-b border-white/10 px-4 py-3 last:border-b-0 ${selected ? "bg-white/[.03]" : ""}`}
    >
      <div>
        <div className="text-[13px] text-fg">v{release.version}</div>
        <div className="text-[11px] text-subtle">{release.backbones.map((b) => b.name).join(" + ")}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
          {Math.round(release.benchmark.accuracyWithin50m * 100)}% ≤ 50m
        </span>
        {release.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
        {!release.isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onInstall(); }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
          >
            Instalar
          </button>
        )}
      </div>
    </div>
  );
}

function ExplorarTab() {
  const [bundles, setBundles] = useState<CatalogBundle[]>([]);
  const [selected, setSelected] = useState<{ owner: string; repo: string; release: CatalogRelease } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setBundles(r.data?.bundles ?? []));
  }, []);

  async function install(owner: string, repo: string, release: CatalogRelease) {
    setStatus(`Instalando v${release.version}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo, tag: release.tag }),
    });
    setStatus(ok ? `Instalada v${release.version}` : (data as { error?: string })?.error ?? "No se pudo instalar");
  }

  return (
    <div>
      {status && <div className="mb-3 text-xs text-muted">{status}</div>}
      {bundles.map((bundle) => (
        <FloatingCard key={`${bundle.owner}/${bundle.repo}`} className="mb-3 overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-[13.5px] font-medium text-fg">Lumi Preview</div>
            <div className="text-[11px] text-subtle">github.com/{bundle.owner}/{bundle.repo} · {bundle.releases.length} release{bundle.releases.length === 1 ? "" : "s"}</div>
          </div>
          {bundle.releases.map((release) => (
            <ReleaseRow
              key={release.tag}
              owner={bundle.owner}
              repo={bundle.repo}
              release={release}
              selected={selected?.release.tag === release.tag}
              onSelect={() => setSelected({ owner: bundle.owner, repo: bundle.repo, release })}
              onInstall={() => install(bundle.owner, bundle.repo, release)}
            />
          ))}
        </FloatingCard>
      ))}
      {selected && (
        <FloatingCard className="p-5">
          <div className="text-[14px] font-medium text-fg">Lumi Preview v{selected.release.version}</div>
          <div className="mt-3 flex gap-6">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Precisión (≤50m)</div>
              <div className="mt-0.5 text-[17px] text-fg">{Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Distancia media</div>
              <div className="mt-0.5 text-[17px] text-fg">{selected.release.benchmark.avgDistanceM.toFixed(1)}m</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Casos evaluados</div>
              <div className="mt-0.5 text-[17px] text-fg">{selected.release.benchmark.sampleCount}</div>
            </div>
          </div>
        </FloatingCard>
      )}
    </div>
  );
}

function PublicarTab() {
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [benchmark, setBenchmark] = useState<CatalogBenchmark | null>(null);

  async function publish() {
    setStatus({ tone: "ok", text: "Publicando… (ejecutando benchmark)" });
    const { ok, data } = await fetchJson("/api/model-catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (ok) {
      setBenchmark((data as { benchmark: CatalogBenchmark }).benchmark);
      setStatus({ tone: "ok", text: "Publicado" });
    } else {
      const body = data as { error?: string; benchmark?: CatalogBenchmark };
      if (body.benchmark) setBenchmark(body.benchmark);
      setStatus({ tone: "error", text: body.error ?? "El benchmark no superó el umbral — no se publicó nada" });
    }
  }

  return (
    <FloatingCard className="p-5">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted">Descripción de esta versión</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        {benchmark && (
          <div className={`rounded-md border px-3 py-2.5 text-[11.5px] ${
            benchmark.accuracyWithin50m >= 0.7
              ? "border-[rgba(120,200,140,0.4)] bg-[rgba(120,200,140,0.08)] text-[#8fd6a3]"
              : "border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] text-danger-fg"
          }`}>
            {Math.round(benchmark.accuracyWithin50m * 100)}% de {benchmark.sampleCount} casos a menos de 50m (umbral: 70%)
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={publish} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Publicar
          </button>
          {status && <span className={`text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</span>}
        </div>
      </div>
    </FloatingCard>
  );
}

export function ModelCatalogPanel() {
  const [tab, setTab] = useState<"explorar" | "publicar">("explorar");
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-white/10">
        {(["explorar", "publicar"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-[12.5px] ${tab === id ? "border-b-2 border-accent font-medium text-fg" : "text-muted hover:text-fg"}`}
          >
            {id === "explorar" ? "Explorar" : "Publicar"}
          </button>
        ))}
      </div>
      {tab === "explorar" ? <ExplorarTab /> : <PublicarTab />}
    </div>
  );
}
