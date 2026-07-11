// apps/web/app/components/AreasManagePanel.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { fetchJson } from "../lib/fetch-json";

interface AreaItem {
  id: string;
  name: string | null;
  area_km2: string; // pg returns `numeric` columns as strings, not JS numbers
  status: string;
  images_embedded: number;
}

type Busy = "export" | "merge" | "import" | null;

export function AreasManagePanel() {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadAreas() {
    const { data } = await fetchJson<{ areas: AreaItem[] }>("/api/areas");
    setAreas(data?.areas ?? []);
  }
  useEffect(() => {
    loadAreas();
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    if (selected.size === 0) return;
    setBusy("export");
    setStatus(null);
    const res = await fetch("/api/areas/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaIds: [...selected] }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setStatus({ tone: "error", text: data?.error ?? "No se pudo exportar" });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
    a.download = match?.[1] ?? "lumi-areas.zip";
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ tone: "ok", text: `${selected.size} área(s) exportada(s)` });
  }

  async function handleMerge() {
    if (selected.size < 2) return;
    setBusy("merge");
    setStatus(null);
    const { ok, data } = await fetchJson<{ areaId: string; error?: string }>("/api/areas/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaIds: [...selected] }),
    });
    setBusy(null);
    if (!ok) {
      setStatus({ tone: "error", text: data?.error ?? "No se pudo fusionar" });
      return;
    }
    setSelected(new Set());
    setStatus({ tone: "ok", text: "Áreas fusionadas correctamente" });
    loadAreas();
  }

  async function handleImportFile(file: File) {
    setBusy("import");
    setStatus(null);
    const form = new FormData();
    form.append("file", file);
    const { ok, data } = await fetchJson<{ importedAreaIds: string[]; error?: string }>(
      "/api/areas/import",
      { method: "POST", body: form }
    );
    setBusy(null);
    if (!ok) {
      setStatus({ tone: "error", text: data?.error ?? "No se pudo importar" });
      return;
    }
    setStatus({ tone: "ok", text: `${data?.importedAreaIds.length ?? 0} área(s) importada(s)` });
    loadAreas();
  }

  return (
    <FloatingCard className="p-5">
      <h2 className="mb-4 text-sm font-medium text-fg">Áreas indexadas</h2>

      <div className="mb-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-white/[.02] p-2">
        {areas.length === 0 && <p className="p-2 text-xs text-subtle">No hay áreas indexadas.</p>}
        {areas.map((a) => (
          <label
            key={a.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg hover:bg-white/5"
          >
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              className="accent-accent"
            />
            <span className="flex-1 truncate">{a.name || "Sin nombre"}</span>
            <span className="text-subtle">
              {/* pg returns numeric columns (area_km2) as strings, not JS numbers, to avoid precision loss */}
              {Number(a.area_km2).toFixed(1)} km² · {a.images_embedded} img · {a.status}
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleExport}
          disabled={selected.size === 0 || busy !== null}
          className="rounded-md bg-elevated px-3 py-2 text-xs text-fg hover:bg-white/10 disabled:opacity-50"
        >
          {busy === "export" ? "Exportando…" : `Exportar seleccionadas (${selected.size})`}
        </button>
        <button
          onClick={handleMerge}
          disabled={selected.size < 2 || busy !== null}
          title={selected.size < 2 ? "Selecciona al menos 2 áreas" : undefined}
          className="rounded-md bg-elevated px-3 py-2 text-xs text-fg hover:bg-white/10 disabled:opacity-50"
        >
          {busy === "merge" ? "Fusionando…" : `Fusionar seleccionadas (${selected.size})`}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== null}
          className="rounded-md border border-white/15 px-3 py-2 text-xs text-fg hover:bg-white/10 disabled:opacity-50"
        >
          {busy === "import" ? "Importando…" : "Importar desde .zip"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {status && (
        <p className={`mt-2 text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</p>
      )}
    </FloatingCard>
  );
}
