import { useEffect, useState } from "react";

import { FolderImportDialog } from "../ingest/FolderImportDialog";
import { LegacyImportDialog } from "../ingest/LegacyImportDialog";
import { api, type DetalleIndice, type LoteResumen, type Modelo, type ProgresoIndiceEmbed, type Sesion } from "../lib/api";
import { PublishDialog } from "../publish/PublishDialog";
import { estadoActual } from "../publish/publishTracker";
import { SealDialog } from "../seal/SealDialog";
import { EmbedToggle } from "../ui/EmbedToggle";
import { Icon } from "../ui/Icon";
import { IndexQueueBar } from "../ui/IndexQueueBar";
import { Overlay } from "../ui/Overlay";
import { IndexMapDialog } from "./IndexMapDialog";
import { ProvenanceTable } from "./ProvenanceTable";
import { TeselasPanel } from "./TeselasPanel";

/** `soloLectura` esconde todo lo que escribe, exactamente el mismo mecanismo
 *  que ya usa con un índice sellado: mirar el índice de otra persona no
 *  necesita una pantalla paralela que mantener.
 *
 *  `onNuevaVersion` es cómo se navega tras "Crear versión nueva": la fila
 *  nueva ya existe y está abierta, y quedarse mirando el índice sellado del
 *  que salió sería el paso extra que nadie quiere dar. */
export function IndexDetail({ id, onVolver, onNuevaVersion, soloLectura = false }: {
  id: number; onVolver: () => void; onNuevaVersion?: (id: number) => void; soloLectura?: boolean;
}) {
  const [detalle, setDetalle] = useState<DetalleIndice | null>(null);
  const [lotes, setLotes] = useState<LoteResumen[]>([]);
  const [embed, setEmbed] = useState<ProgresoIndiceEmbed[]>([]);
  const [sellando, setSellando] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [importando, setImportando] = useState<"carpeta" | "legacy" | null>(null);
  const [mapaAbierto, setMapaAbierto] = useState(false);
  // Si ya hay una publicación de este índice corriendo de fondo —por ejemplo,
  // se volvió aquí pulsando el aviso—, el diálogo se abre directamente en su
  // paso de subida en vez de forzar a pulsar «Publicar» otra vez.
  const [publicando, setPublicando] = useState(() => estadoActual()?.indiceId === id);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [creandoVersion, setCreandoVersion] = useState(false);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [reembebiendo, setReembebiendo] = useState<string | null>(null);

  useEffect(() => { void api.identidadLeer().then(setSesion); }, []);
  useEffect(() => { void api.modelosLista().then(setModelos); }, []);

  const refrescar = () => {
    void api.indiceDetalle(id).then(setDetalle);
    void api.indiceLotes(id).then(setLotes);
  };

  useEffect(() => {
    refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Aparte del refresco de arriba: esto SÍ tiene que sondear de continuo —es
  // la única señal de que el embebido de fondo terminó sin tener que
  // adivinarlo mirando una barra que no distinguía "en curso" de "completo".
  useEffect(() => {
    const tick = () => void api.indiceProgresoEmbebido(id).then(setEmbed);
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [id]);

  const conTrabajo = embed.filter((f) => f.total > 0);
  const embebidoCompleto = conTrabajo.length > 0 && conTrabajo.every((f) => f.hechas === f.total);
  const embebiendo = conTrabajo.some((f) => f.hechas < f.total);

  async function cancelarLote(loteId: number) {
    setCancelando(loteId);
    try {
      await api.loteCancelar(loteId);
      setLotes(await api.indiceLotes(id));
    } finally {
      setCancelando(null);
    }
  }

  async function borrar() {
    if (!confirmarBorrado) { setConfirmarBorrado(true); return; }
    setBorrando(true);
    try {
      await api.indiceBorrar(id);
      onVolver();
    } finally {
      setBorrando(false);
    }
  }

  async function crearVersion() {
    setCreandoVersion(true);
    try {
      const nuevaId = await api.versionCrear(id);
      onNuevaVersion?.(nuevaId);
    } finally {
      setCreandoVersion(false);
    }
  }

  async function reembeber(modeloId: string) {
    setReembebiendo(modeloId);
    try {
      await api.indiceReembeber(id, modeloId);
    } finally {
      setReembebiendo(null);
    }
  }

  if (!detalle) return null;
  const vacio = detalle.imagenes.imagenes_total === 0;
  const sellado = detalle.estado === "sellado";
  // Un modelo sin ninguna fila de `vectores` para este índice —`total === 0`
  // en su progreso, con el índice no vacío— es una capa que nunca se generó.
  // Añadirla es un pase de GPU sobre las fotos que ya están en disco, no una
  // campaña de descarga.
  const faltantes = vacio
    ? []
    : modelos.filter((m) => (embed.find((e) => e.modelo_id === m.id)?.total ?? 0) === 0);
  const motivoSellarDeshabilitado = vacio
    ? "el índice todavía no tiene imágenes"
    : !embebidoCompleto
      ? "faltan imágenes por embeber — sellar antes dejaría un paquete a medias"
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col gap-5 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <button onClick={onVolver} className="flex w-fit items-center gap-1.5 text-[11px] text-subtle hover:text-fg">
            <Icon name="back" size={11} /> Índices
          </button>
          <div className="flex items-center gap-2">
            {!soloLectura && <button
              onClick={() => void borrar()}
              onBlur={() => setConfirmarBorrado(false)}
              disabled={borrando}
              className={`jg-press rounded-lg border px-3 py-1.5 text-[11px] disabled:opacity-40 ${
                confirmarBorrado
                  ? "border-danger bg-danger/10 text-danger-fg"
                  : "border-border text-subtle hover:text-danger-fg"}`}
            >
              {borrando ? "Borrando…" : confirmarBorrado ? "¿Seguro? Borrar del todo" : "Borrar índice"}
            </button>}
            {!sellado && !soloLectura && (
              <button
                onClick={() => setSellando(true)}
                disabled={vacio || !embebidoCompleto}
                title={motivoSellarDeshabilitado}
                className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40"
              >
                Sellar
              </button>
            )}
            {sellado && !soloLectura && (
              <button onClick={() => void crearVersion()} disabled={creandoVersion}
                title="Clona este índice en una fila nueva y abierta, con el mismo contenido — sin duplicar las fotos en disco"
                className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40">
                {creandoVersion ? "Creando versión…" : "Crear versión nueva"}
              </button>
            )}
            {sellado && !soloLectura && (
              <button onClick={() => setPublicando(true)} disabled={!sesion}
                title={sesion ? undefined : "conecta una cuenta en Ajustes para publicar"}
                className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40">
                Publicar
              </button>
            )}
          </div>
        </div>

        {sellando && (
          <Overlay>
            <SealDialog indiceId={id} nombre={detalle.nombre} onSellado={() => setSellando(false)} />
          </Overlay>
        )}
        {importando && (
          <Overlay>
            {importando === "carpeta"
              ? <FolderImportDialog indiceId={id} onHecho={() => { setImportando(null); refrescar(); }} />
              : <LegacyImportDialog indiceId={id} onHecho={() => { setImportando(null); refrescar(); }} />}
          </Overlay>
        )}
        {mapaAbierto && (
          <Overlay>
            <IndexMapDialog indiceId={id} nombreIndice={detalle.nombre} onCerrar={() => setMapaAbierto(false)} />
          </Overlay>
        )}
        {publicando && (
          <Overlay>
            <PublishDialog indiceId={id} nombre={detalle.nombre} onHecho={() => setPublicando(false)} />
          </Overlay>
        )}

        <div className="flex items-baseline gap-2.5">
          <p className="text-[15px] text-fg">{detalle.nombre}</p>
          <span className="font-mono text-[10.5px] text-subtle">{detalle.slug}</span>
          <span className="rounded-full border border-border px-2 py-px text-[9px] text-subtle">
            {detalle.estado}
          </span>
          {detalle.numero_version > 1 && (
            <span className="rounded-full border border-border px-2 py-px font-mono text-[9px] text-subtle">
              v{detalle.numero_version}
            </span>
          )}
          {/* La señal de que el embebido de fondo terminó: antes la única
              pista era una barra de progreso al 100 % indistinguible, de un
              vistazo, de una que sigue subiendo despacio. */}
          {!vacio && (
            embebidoCompleto ? (
              <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-px text-[9px] text-fg">
                <Icon name="check" size={9} /> embebido completo
              </span>
            ) : embebiendo ? (
              <span className="flex items-center gap-1.5 rounded-full border border-draw-fg/40 px-2 py-px text-[9px] text-draw-fg">
                <span className="h-[6px] w-[6px] rounded-full bg-draw-fg"
                  style={{ animation: "jg-core-pulse 2.6s ease-in-out infinite" }} />
                embebiendo
              </span>
            ) : (
              <span className="rounded-full border border-warning/[.35] px-2 py-px text-[9px] text-warning-fg">
                sin embeber
              </span>
            )
          )}
        </div>

        {!sellado && !soloLectura && (
          <div className="flex items-center gap-2">
            <button onClick={() => setImportando("carpeta")}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
              Importar carpeta
            </button>
            <button onClick={() => setImportando("legacy")}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
              Importar índice legacy
            </button>
            <button onClick={() => setMapaAbierto(true)} disabled={vacio}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40">
              Abrir en mapa
            </button>
            <span className="flex-1" />
            <EmbedToggle />
          </div>
        )}

        {!vacio && faltantes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] leading-relaxed text-subtle">
              recorre las fotos que ya están en disco; no descarga nada ni gasta presupuesto
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {faltantes.map((m) => (
                <button key={m.id}
                  onClick={() => void reembeber(m.id)}
                  disabled={sellado || reembebiendo === m.id}
                  title={sellado ? "este índice está sellado: sus vectores viven en un paquete cerrado — crea una versión nueva para seguir llenándolo" : undefined}
                  className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg disabled:opacity-40">
                  {reembebiendo === m.id ? `Encolando ${m.nombre}…` : `Añadir capa ${m.nombre}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {sellado && (
          <button onClick={() => setMapaAbierto(true)}
            className="jg-press w-fit rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
            Abrir en mapa
          </button>
        )}

        <div className="flex gap-6">
          <Stat etiqueta="Imágenes" valor={detalle.imagenes.imagenes_total} />
          <Stat etiqueta="Teselas z14" valor={detalle.imagenes.teselas_total} />
          <Stat etiqueta="Lotes" valor={lotes.length} />
        </div>

        <div className="grid grid-cols-[1fr_260px] gap-6">
          {vacio ? (
            <div className="rounded-card border border-dashed border-border p-6 text-center">
              <p className="text-[11.5px] text-fg">Este índice todavía no tiene imágenes</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
                Ve a <b className="font-normal text-fg">Territorio</b> para dibujar un área y descargar
                de la red, o usa <b className="font-normal text-fg">Importar carpeta</b> /{" "}
                <b className="font-normal text-fg">Importar índice legacy</b> arriba para traer material
                de fuera.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <ProvenanceTable p={detalle.imagenes} trabajo={detalle.trabajo} />
              {!sellado && !soloLectura && <TeselasPanel indiceId={id} />}
            </div>
          )}

          <div>
            <p className="mb-2 text-[10.5px] uppercase tracking-[.08em] text-subtle">Lotes</p>
            <div className="flex flex-col gap-1.5">
              {lotes.length === 0 && (
                <p className="text-[11px] leading-relaxed text-subtle">
                  Sin lotes todavía. Cada importación o descarga añade uno aquí.
                </p>
              )}
              {lotes.map((l) => (
                <div key={l.id} className="rounded-lg border border-border px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-fg">{l.clase}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`rounded-full border px-1.5 py-px text-[9px] ${
                        l.estado === "hecho" ? "border-border text-subtle"
                          : l.estado === "error" ? "border-danger text-danger-fg"
                            : l.estado === "cancelado" ? "border-border text-subtle"
                              : "border-draw-fg text-draw-fg"}`}>
                        {l.estado}
                      </span>
                      {l.estado === "pendiente" && (
                        <button
                          onClick={() => void cancelarLote(l.id)}
                          disabled={cancelando === l.id}
                          className="jg-press rounded-full border border-border px-1.5 py-px text-[9px] text-subtle hover:border-danger hover:text-danger-fg disabled:opacity-40"
                        >
                          {cancelando === l.id ? "Cancelando…" : "Cancelar"}
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[9.5px] text-subtle">{l.origen}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <IndexQueueBar indiceId={id} />
    </div>
  );
}

function Stat({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">{etiqueta}</p>
      <p className="mt-1 font-mono text-[15px] text-fg">{valor.toLocaleString("es-ES")}</p>
    </div>
  );
}
