// apps/web/app/components/DatasetsCatalogPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { fetchJson } from "../lib/fetch-json";

interface ModelTag { id: string; version: string; embeddingDim: number }
interface DatasetRelease {
  tag: string; title: string; description: string; model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number }; compatible: boolean;
}
interface DatasetArea { owner: string; repo: string; releases: DatasetRelease[] }

function ReleaseRow({
  owner, repo, release, onInstall,
}: { owner: string; repo: string; release: DatasetRelease; onInstall: (owner: string, repo: string, release: DatasetRelease) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 last:border-b-0">
      <div>
        <div className="text-[13px] text-fg">{release.model.id} v{release.model.version}</div>
        <div className="text-[11px] text-subtle">{release.stats.pointsCaptured} puntos · {release.stats.imagesEmbedded} imágenes</div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
            release.compatible
              ? "border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] text-[#8fd6a3]"
              : "border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.12)] text-warning-fg"
          }`}
        >
          {release.compatible ? "Compatible" : "Requiere completar embeddings"}
        </span>
        <button
          onClick={() => onInstall(owner, repo, release)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
        >
          Instalar
        </button>
      </div>
    </div>
  );
}

function MismatchDialog({
  release, onCancel, onConfirm,
}: { release: DatasetRelease; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[420px] p-5">
        <div className="text-[13.5px] font-medium text-fg">Modelo distinto al activo</div>
        <p className="mt-2.5 text-[12.5px] text-muted">
          Este dataset se construyó con <b className="text-fg">{release.model.id} v{release.model.version}</b>.
          Se instalarán las imágenes y puntos igualmente, y se completarán los embeddings automáticamente con tu
          modelo activo (sin volver a gastar cuota de Street View). El área aparecerá como &quot;indexando&quot; hasta que termine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={onConfirm} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Instalar y completar embeddings
          </button>
        </div>
      </FloatingCard>
    </div>
  );
}

function ExplorarTab() {
  const [areas, setAreas] = useState<DatasetArea[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<{ owner: string; repo: string; release: DatasetRelease } | null>(null);

  useEffect(() => {
    fetchJson<{ areas: DatasetArea[] }>("/api/datasets").then((r) => setAreas(r.data?.areas ?? []));
  }, []);

  async function install(owner: string, repo: string, release: DatasetRelease, forceInstall: boolean) {
    setStatus("Instalando…");
    const { ok, data } = await fetchJson("/api/datasets/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo, tag: release.tag, forceInstall }),
    });
    if (!ok && (data as { compatible?: boolean })?.compatible === false && !forceInstall) {
      setPendingInstall({ owner, repo, release });
      setStatus(null);
      return;
    }
    setStatus(ok ? "Instalado" : (data as { error?: string })?.error ?? "No se pudo instalar");
  }

  return (
    <div>
      {status && <div className="mb-3 text-xs text-muted">{status}</div>}
      {areas.map((area) => (
        <FloatingCard key={`${area.owner}/${area.repo}`} className="mb-3 overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-[13.5px] font-medium text-fg">{area.repo}</div>
            <div className="text-[11px] text-subtle">github.com/{area.owner}/{area.repo} · {area.releases.length} release{area.releases.length === 1 ? "" : "s"}</div>
          </div>
          {area.releases.map((release) => (
            <ReleaseRow
              key={release.tag}
              owner={area.owner}
              repo={area.repo}
              release={release}
              onInstall={(o, r, rel) => install(o, r, rel, false)}
            />
          ))}
        </FloatingCard>
      ))}
      {pendingInstall && (
        <MismatchDialog
          release={pendingInstall.release}
          onCancel={() => setPendingInstall(null)}
          onConfirm={() => {
            const { owner, repo, release } = pendingInstall;
            setPendingInstall(null);
            install(owner, repo, release, true);
          }}
        />
      )}
    </div>
  );
}

function PublicarTab() {
  const [areaId, setAreaId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function publish() {
    setStatus("Publicando…");
    const { ok, data } = await fetchJson("/api/datasets/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaId, title, description, owner, repo }),
    });
    setStatus(ok ? "Publicado" : (data as { error?: string })?.error ?? "No se pudo publicar");
  }

  return (
    <FloatingCard className="p-5">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted">ID del área indexada</label>
          <input value={areaId} onChange={(e) => setAreaId(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Descripción</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Repositorio destino (owner/repo)</label>
          <div className="flex gap-2">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner"
              className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo"
              className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
          </div>
        </div>
        <div className="rounded-md border border-dashed border-white/22 bg-white/[.03] px-3 py-2 text-xs text-muted">
          🔒 Se publicará etiquetado con tu modelo de retrieval activo ahora mismo (no editable).
        </div>
        <div className="flex items-start gap-2 rounded-md border border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] px-3 py-2.5 text-[11.5px] text-danger-fg">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
          <span>
            Entiendo que publicar contenido de Street View reempaquetado a otros usuarios puede infringir los
            Términos de Servicio de Google Maps Platform (ver docs/PROOF_OF_CONCEPT.md §3.1) y asumo esa responsabilidad.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={publish}
            disabled={!accepted || !areaId || !title || !description || !owner || !repo}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
          >
            Publicar
          </button>
          {status && <span className="text-xs text-muted">{status}</span>}
        </div>
      </div>
    </FloatingCard>
  );
}

export function DatasetsCatalogPanel() {
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
