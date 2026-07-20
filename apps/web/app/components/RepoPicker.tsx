// apps/web/app/components/RepoPicker.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { buildRepoRows, type RepoOption } from "../lib/repo-picker";

interface ReposResponse {
  login: string;
  repos: RepoOption[];
}

export function RepoPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState(value);
  const [status, setStatus] = useState<"loading" | "error" | "loaded">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `value` only ever changes externally at mount (PublishWizard's
  // localStorage prefill) or right after this component's own onChange
  // call — either way it's safe to mirror into the local query.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    fetchJson<ReposResponse>("/api/datasets/repos").then((r) => {
      if (!r.ok || !r.data) {
        setErrorMessage((r.data as { error?: string } | null)?.error ?? "No se pudieron cargar los repositorios");
        setStatus("error");
        return;
      }
      setLogin(r.data.login);
      setRepos(r.data.repos);
      setStatus("loaded");
    });
  }, []);

  if (status === "loading") {
    return <div className="mb-3 text-xs text-muted">Cargando repositorios…</div>;
  }
  if (status === "error") {
    return <div className="mb-3 text-xs text-danger-fg">{errorMessage}</div>;
  }

  const rows = buildRepoRows(repos, query, login);

  function select(v: string) {
    onChange(v);
    setQuery(v);
    setOpen(false);
  }

  return (
    <div className="relative mb-3">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Buscar repositorio…"
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
      />
      {open && rows.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-[200px] w-full overflow-y-auto rounded-md border border-white/10 bg-panel">
          {rows.map((row) => (
            <div
              key={row.value}
              onMouseDown={() => {
                if (blurTimeout.current) clearTimeout(blurTimeout.current);
                select(row.value);
              }}
              className="cursor-pointer px-3 py-2 text-xs text-fg hover:bg-white/10"
            >
              {row.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}