import type { Analysis, Hipotesis, Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import type { MenuEntry, MenuState } from "../ui/ContextMenu";
import { menuAt } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { Drawer } from "./Drawer";

/** Metros entre dos coordenadas. Haversine con el radio medio de la Tierra:
 *  precisión de sobra para decir «el EXIF declara un GPS a 300 m de aquí». */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Bajo el análisis seleccionado: la principal (sin índice ni autor propios en
 *  la API, viven en `result_*`) y sus alternativas, numeradas y con su barra
 *  de peso. Que haya alternativas es en sí la señal de que el motor duda, sin
 *  números que interpretar — la frase de arriba es la única lectura que hace
 *  falta.
 *
 *  ponytail: `Hipotesis` no lleva cuántos candidatos respaldan el grupo (eso
 *  es `Grupo::candidatos` en Rust, que no cruza la API); se enseña la
 *  coordenada, el radio, el peso y la procedencia, que es lo que sí viaja. */
function HipotesisList({ a }: { a: Analysis }) {
  if (a.state !== "hecho" || a.result_lat == null || a.result_lng == null) return null;
  const principal: Hipotesis = {
    lat: a.result_lat, lng: a.result_lng, radio_m: a.result_radius_m ?? 0,
    peso: a.result_confidence ?? 0, indice: "", autor: "",
  };
  const todas = [principal, ...a.hypotheses];
  const maxPeso = Math.max(...todas.map((h) => h.peso), 1e-9);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border p-[8px_9px]">
      <p className="text-[10px] leading-relaxed text-muted">
        {a.hypotheses.length > 0
          ? <>Le saca <b className="text-fg">{(a.result_confidence ?? 0).toFixed(1)}×</b> a la siguiente</>
          : "Ninguna otra zona reúne votos suficientes para competir"}
      </p>
      <div className="flex flex-col gap-1.5">
        {todas.map((h, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-px w-3 shrink-0 font-mono text-[9px] text-subtle">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[10.5px] text-fg">
                  {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                </span>
                <span className="font-mono text-[9px] text-subtle">± {Math.round(h.radio_m)} m</span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[.06]">
                <div className="h-full bg-white/40"
                  style={{ width: `${Math.max(6, (h.peso / maxPeso) * 100)}%` }} />
              </div>
              {h.indice && (
                <p className="mt-1 truncate font-mono text-[9px] text-subtle">{h.indice} · @{h.autor}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lo que se sabe de la imagen elegida: la foto, los intentos y el GPS que
 *  declara la cámara. Cabe en el mismo carril que el de invitar y por eso solo
 *  puede estar abierto uno de los dos. */
export function ResultsDrawer({
  open, image, analyses, selected, busy, onSelect, onAnalyze, onCenter, onMenu,
}: {
  open: boolean;
  image: Image | null;
  analyses: Analysis[];
  selected: number | null;
  busy: boolean;
  onSelect: (id: number) => void;
  onAnalyze: () => void;
  onCenter: (lat: number, lng: number) => void;
  onMenu: (s: MenuState) => void;
}) {
  const exif = image?.exif_lat != null && image.exif_lng != null;

  const menuDe = (a: Analysis): MenuEntry[] => {
    const hecho = a.state === "hecho";
    return [
      {
        label: "Centrar en el mapa", disabled: !hecho,
        onClick: () => hecho && onCenter(a.result_lat!, a.result_lng!),
      },
      {
        label: "Copiar coordenadas", hint: "⌘C", disabled: !hecho,
        onClick: () => hecho && void navigator.clipboard.writeText(
          `${a.result_lat!.toFixed(6)}, ${a.result_lng!.toFixed(6)}`),
      },
      null,
      { label: "Repetir con otro modelo…", onClick: onAnalyze },
    ];
  };

  return (
    <Drawer open={open}>
      {image && (
        <div className="flex items-center gap-2 rounded-[9px] bg-white/[.03] p-[7px]">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-[30px] w-[38px] shrink-0 rounded bg-elevated object-cover" />
          <span className="truncate font-mono text-[10px] text-muted">{image.filename}</span>
        </div>
      )}

      {analyses.map((a, i) => {
        const hecho = a.state === "hecho";
        const on = a.id === selected;
        return (
          <button key={a.id} onClick={() => onSelect(a.id)}
            onContextMenu={(e) => menuAt(e, `${i + 1} · ${a.model}`, menuDe(a), onMenu)}
            style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 6) * 30}ms cubic-bezier(.16,1,.3,1) both` }}
            className={`rounded-[10px] border p-[8px_9px] text-left transition-[border-color,background-color,transform]
              duration-300 ease-expo hover:-translate-x-0.5 ${
                on ? "border-white/[.35] bg-white/[.04]" : "border-border hover:border-white/[.18]"}`}>
            <div className="text-[9px] uppercase tracking-[.11em] text-subtle">{i + 1} · {a.model}</div>
            <div className={`text-[11.5px] ${hecho ? "text-fg" : "text-muted"}`}>
              {hecho
                ? `${a.result_lat!.toFixed(4)}, ${a.result_lng!.toFixed(4)}`
                : a.state === "error"
                  ? a.error ?? "falló sin dejar motivo"
                  : "esperando al motor"}
            </div>
            {hecho && (
              <div className="mt-[3px] text-[9px] uppercase tracking-[.11em] text-subtle">
                {(a.result_confidence ?? 0).toFixed(2)} · {Math.round(a.result_radius_m ?? 0)} m
              </div>
            )}
          </button>
        );
      })}

      {(() => {
        const shownA = analyses.find((a) => a.id === selected) ?? null;
        return shownA && <HipotesisList a={shownA} />;
      })()}

      {/* El GPS declarado tiene sitio propio y color ámbar: no es una
          candidata, es lo que dice la cámara. */}
      {exif && (
        <div className="rounded-[10px] border border-warning/30 p-[8px_9px]">
          <div className="text-[9px] uppercase tracking-[.11em] text-subtle">E · EXIF</div>
          <div className="text-[11.5px] text-warning-fg">
            {image!.exif_lat!.toFixed(4)}, {image!.exif_lng!.toFixed(4)}
          </div>
        </div>
      )}

      <div className="mt-1 flex flex-col gap-1 opacity-[.55]">
        {([["clock", "Hora estimada"], ["cloud", "Clima"], ["boxes", "Objetos"]] as const).map(([ic, l]) => (
          <div key={ic} title="modelo no instalado"
            className="flex items-center gap-2 rounded-[9px] border border-border p-[6px_9px]">
            <Icon name={ic} size={12} className="text-subtle" />
            <span className="flex-1 text-[11px] text-muted">{l}</span>
            <Icon name="lock" size={11} className="text-subtle" />
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <button onClick={onAnalyze} disabled={busy}
        className="jg-press w-full rounded-[9px] border border-white/15 px-3 py-2 text-[11.5px]
          text-fg disabled:opacity-40">
        {busy ? "Un momento…" : "Analizar otra vez"}
      </button>
    </Drawer>
  );
}
