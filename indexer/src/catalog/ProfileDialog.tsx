import { useEffect, useState } from "react";

import { api, type Perfil, type PerfilGithub } from "../lib/api";
import { CoverageMap } from "./CoverageMap";
import { opacidadSegmento, SegmentBar } from "./SourceBar";

function fecha(epochSeg: string): string {
  const n = Number(epochSeg);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleDateString("es-ES") : "—";
}

/// El `owner/repo` de donde salió un asset publicado — misma extracción que
/// `catalogo::mios` en Rust, sobre la URL de descarga
/// (`https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}`).
/// Hace falta para pedir la liberación: `paquete` solo no localiza la ficha.
function repoDeUrl(url: string): string | null {
  const sinDescarga = url.split("/download/")[0];
  const sinDominio = sinDescarga?.replace(/^https:\/\/github\.com\//, "");
  if (!sinDominio || sinDominio === sinDescarga) return null;
  return sinDominio.replace(/\/releases$/, "");
}

function km2(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: n < 10 ? 1 : 0 });
}

/** La ficha de una cuenta, con la misma forma que el perfil de una cuenta de
 *  GitHub: foto, nombre y bio salen de ahí porque ahí es donde viven — Lumi
 *  no pide a nadie que las repita. Lo propio de Lumi es la fila de
 *  estadísticas y los índices debajo, cada uno con su barra de fuentes. */
export function ProfileDialog({ cuenta, onCerrar }: { cuenta: string; onCerrar: () => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [github, setGithub] = useState<PerfilGithub | null>(null);
  const [cuentaPropia, setCuentaPropia] = useState(false);
  // `paquete → "pidiendo" | "pedida" | mensaje de error`: por paquete, no
  // global, porque nada impide pedir la liberación de dos publicaciones
  // distintas en la misma visita a este diálogo.
  const [liberando, setLiberando] = useState<Record<string, "pidiendo" | "pedida" | string>>({});

  useEffect(() => { void api.catalogoPerfil(cuenta).then(setPerfil); }, [cuenta]);
  useEffect(() => { void api.catalogoPerfilGithub(cuenta).then(setGithub, () => {}); }, [cuenta]);
  useEffect(() => {
    void api.identidadLeer().then((s) => setCuentaPropia(s?.cuenta === cuenta), () => {});
  }, [cuenta]);

  function pedirLiberacion(paquete: string, url: string, quadkeys: string[]) {
    const repo = repoDeUrl(url);
    if (!repo) return;
    setLiberando((l) => ({ ...l, [paquete]: "pidiendo" }));
    api.catalogoSolicitarLiberacion(repo, paquete, quadkeys).then(
      () => setLiberando((l) => ({ ...l, [paquete]: "pedida" })),
      (e) => setLiberando((l) => ({ ...l, [paquete]: String(e) })),
    );
  }

  const publica = perfil ? perfil.publicaciones.length > 0 : false;
  const urlGithub = github?.url ?? `https://github.com/${cuenta}`;
  const capas = perfil ? new Set(perfil.publicaciones.filter((p) => p.capas > 0).map((p) => p.paquete)).size : 0;
  const primera = perfil && perfil.publicaciones.length > 0
    ? fecha(perfil.publicaciones.map((p) => p.publicada_en).sort()[0])
    : "—";
  const totalTeselasPublicadas = perfil ? perfil.publicaciones.reduce((s, p) => s + p.teselas, 0) : 0;

  return (
    <div className="w-[600px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.72)] p-[22px_24px] backdrop-blur-xl">
      <div className="flex items-center gap-3.5">
        {github
          ? <img src={github.avatar_url} alt="" className="h-[52px] w-[52px] shrink-0 rounded-full border border-white/[.10]" />
          : <div className="h-[52px] w-[52px] shrink-0 rounded-full border border-white/[.10] bg-elevated" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] text-fg">{github?.nombre || cuenta}</p>
            <span className="rounded-[5px] border border-border px-1.5 py-px text-[8.5px] tracking-[.04em] text-subtle">github</span>
          </div>
          <p className="mt-[3px] truncate font-mono text-[10px] text-subtle">@{cuenta}</p>
        </div>
        <a href={urlGithub} target="_blank" rel="noreferrer"
          className="jg-press shrink-0 rounded-lg border border-white/[.15] px-2.5 py-[5px] text-[10.5px] text-fg">
          Ver en GitHub
        </a>
      </div>

      {github?.bio && <p className="mt-3.5 text-[11px] leading-relaxed text-muted">{github.bio}</p>}

      {publica ? (
        <>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
            <Stat k="índices publicados" v={perfil!.publicaciones.length} />
            <Stat k="teselas z14 cubiertas" v={perfil!.teselas} />
            <Stat k="km² cubiertos" v={km2(perfil!.km2)} />
            <Stat k="capas de modelo" v={capas} />
            <Stat k="primera publicación" v={primera} mono={false} />
          </div>

          <div className="mt-[18px] h-px bg-border" />

          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">cobertura</p>
          <div className="mt-2.5">
            <CoverageMap quadkeys={perfil!.quadkeys} />
          </div>

          <p className="mt-4 text-[8px] uppercase tracking-[.11em] text-subtle">publicaciones recientes</p>
          <div className="mt-2.5">
            <SegmentBar pesos={perfil!.publicaciones.map((p) => p.teselas)} />
            <div className="mt-[9px] flex flex-col gap-2">
              {perfil!.publicaciones.map((p, i) => {
                const pct = totalTeselasPublicadas > 0 ? (p.teselas / totalTeselasPublicadas) * 100 : 0;
                const estado = liberando[p.paquete];
                return (
                  <div key={p.paquete} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[10.5px] text-muted">
                      <s className="block h-[7px] w-[7px] shrink-0 rounded-sm no-underline"
                        style={{ background: opacidadSegmento(i) }} />
                      <a href={p.url} target="_blank" rel="noreferrer"
                        className="flex-1 truncate text-fg hover:underline">
                        {p.nombre}
                      </a>
                      <span className="shrink-0 font-mono text-[9.5px] text-subtle">
                        {pct.toFixed(0)}% · {p.teselas} teselas{p.numero_version > 1 ? ` · v${p.numero_version}` : ""}
                        {p.viva ? "" : " · no disponible"}
                      </span>
                      {cuentaPropia && p.viva && estado !== "pedida" && (
                        <button
                          disabled={estado === "pidiendo"}
                          onClick={() => pedirLiberacion(p.paquete, p.url, p.quadkeys)}
                          className="jg-press shrink-0 rounded-[5px] border border-white/[.15] px-2 py-[3px] text-[9.5px] text-fg disabled:opacity-50">
                          {estado === "pidiendo" ? "Pidiendo…" : "Liberar"}
                        </button>
                      )}
                    </div>
                    {estado === "pedida" && (
                      <p className="pl-[15px] text-[9.5px] text-subtle">
                        Solicitud enviada — se procesará en la próxima actualización del catálogo, no es instantánea.
                      </p>
                    )}
                    {estado && estado !== "pidiendo" && estado !== "pedida" && (
                      <p className="pl-[15px] text-[9.5px] text-warning-fg">{estado}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mt-[18px] h-px bg-border" />
          <p className="mt-3.5 text-[12px] text-muted">Esta cuenta no ha publicado nada para Lumi.</p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
            Existe en GitHub, pero ninguno de sus repositorios lleva la etiqueta{" "}
            <span className="font-mono">lumi-index</span>.
          </p>
        </>
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={onCerrar} className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Stat({ k, v, mono = true }: { k: string; v: string | number; mono?: boolean }) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</p>
      <p className={`mt-1 text-[16px] text-fg ${mono ? "font-mono" : ""}`}>{v}</p>
    </div>
  );
}
