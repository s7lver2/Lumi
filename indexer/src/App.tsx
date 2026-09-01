import { useEffect, useState } from "react";

import { IndexDetail } from "./catalog/IndexDetail";
import { IndexPicker } from "./catalog/IndexPicker";
import { DescargaYEmbebidoView } from "./embed/DescargaYEmbebidoView";
import { api, type PlanPendiente, type Saludo } from "./lib/api";
import { ProjectsView } from "./projects/ProjectsView";
import { ReviewGrid } from "./review/ReviewGrid";
import { ActualizacionesPanel } from "./settings/ActualizacionesPanel";
import { DebugPanel } from "./settings/DebugPanel";
import { IdentityPanel } from "./settings/IdentityPanel";
import { OriginsPanel } from "./settings/OriginsPanel";
import { RendimientoPanel } from "./settings/RendimientoPanel";
import { StoragePanel } from "./settings/StoragePanel";
import { Booting } from "./setup/Booting";
import { IdentityStep } from "./setup/IdentityStep";
import { ServicesBoot } from "./setup/ServicesBoot";
import { ServicesFailDialog } from "./setup/ServicesFailDialog";
import { ServicesPanel } from "./setup/ServicesPanel";
import { SetupWizard } from "./setup/SetupWizard";
import { TerritoryView } from "./territory/TerritoryView";
import { PlanetBackground } from "./ui/PlanetBackground";
import { ActualizacionBanner } from "./ui/ActualizacionBanner";
import { comprobarActualizacion, dispararActualizacionSilenciosa, errorActualizacionPendiente, type EstadoActualizacion } from "./lib/actualizaciones";
import { PublishToast } from "./ui/PublishToast";
import { Rail, type Destino } from "./ui/Rail";
import { WindowFrame } from "./ui/WindowFrame";

export function App() {
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [dentro, setDentro] = useState(false);
  const [destino, setDestino] = useState<Destino>("proyectos");
  const [indiceAbierto, setIndiceAbierto] = useState<number | null>(null);
  // El nombre real del índice abierto en Territorio, para que el diálogo de
  // plan no invente uno — se pone al elegir en `IndexPicker` y se limpia
  // junto con `indiceAbierto` en todos los puntos donde ese se limpia.
  const [nombreIndiceAbierto, setNombreIndiceAbierto] = useState<string>("");
  // Aparte de `indiceAbierto`: navegar a "Índices" mientras una descarga
  // corre limpia `indiceAbierto`, pero la descarga sigue viva en el backend y
  // "para qué índice era" no puede depender de una pestaña que ya se dejó.
  // También es lo que le dice al carril si el icono de "Descarga" tiene que
  // seguir visible aunque ya no sea la pestaña activa.
  const [descargaIndiceId, setDescargaIndiceId] = useState<number | null>(null);
  // La estimación del sondeo, para que el ETA de la descarga tenga con qué
  // medir "cuánto falta" en imágenes reales — vive junto a `descargaIndiceId`
  // por la misma razón: sobrevive a navegar fuera y volver a la pestaña.
  const [imagenesEstimadas, setImagenesEstimadas] = useState<number | null>(null);
  const [pestana, setPestana] = useState<"identidad" | "servicios" | "rendimiento" | "almacenamiento" | "origenes" | "actualizaciones" | "debug">("identidad");
  // Lo que quedó a medias si la app se cerró en plena descarga. Se comprueba
  // una vez al entrar: si `correr()` llegó a su final la última vez —bien,
  // parado a mano, o sin saldo— esto ya viene borrado del backend.
  const [pendiente, setPendiente] = useState<PlanPendiente | null>(null);
  const [reanudando, setReanudando] = useState(false);
  // `null` mientras se comprueba. Sin esto, el asistente parpadearía un
  // instante en cada arranque antes de descubrir que ya estaba hecho.
  const [setupListo, setSetupListo] = useState<boolean | null>(null);
  // El mensaje del popup cuando Redis/Qdrant no arrancan solos al abrir la
  // app tras el primer arranque (el asistente ya se completó, así que aquí no
  // se vuelve a mostrar `ServicesStep`, pero los dos servicios SIGUEN siendo
  // procesos hijos que mueren al cerrar el Indexer la vez anterior).
  const [serviciosFallo, setServiciosFallo] = useState<string | null>(null);
  // Se ofrece una vez, cuando los servicios ya arrancaron y NO hay cuenta
  // conectada. Con cuenta no se pregunta nada: la identidad es opcional y
  // preguntar en cada arranque por algo opcional es exactamente el ruido que
  // el paso saltable existe para evitar.
  const [ofrecerIdentidad, setOfrecerIdentidad] = useState(false);
  // Para el punto naranja de «Embebido» en el carril, igual que el de
  // «Descarga»: se ve desde cualquier pantalla que algo sigue corriendo
  // detrás, sin tener que entrar a comprobarlo.
  const [embebiendoActivo, setEmbebiendoActivo] = useState(false);
  const [actualizacion, setActualizacion] = useState<EstadoActualizacion | null>(null);
  const [actualizacionCerrada, setActualizacionCerrada] = useState(false);

  useEffect(() => {
    errorActualizacionPendiente().then((motivo) => {
      if (motivo) setActualizacion({ tipo: "error", motivo });
    });
    comprobarActualizacion().then((estado) => {
      if (estado?.tipo === "disponible") {
        void dispararActualizacionSilenciosa(estado.version);
        return; // la app va a cerrarse; no hace falta pintar nada más
      }
      setActualizacion(estado);
    }).catch(() => setActualizacion(null));
  }, []);

  useEffect(() => {
    if (!dentro) return;
    const tick = () => void api.colaProgreso().then((filas) => setEmbebiendoActivo(filas.some((f) => f.trabajando)));
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [dentro]);

  async function traspasarServicios() {
    const sesion = await api.identidadLeer().catch(() => null);
    if (sesion) setDentro(true);
    else setOfrecerIdentidad(true);
  }

  useEffect(() => { void api.saludo().then(setSaludo); }, []);
  useEffect(() => { void api.descargaPendiente().then(setPendiente); }, []);
  useEffect(() => { void api.setupCompleto().then(setSetupListo); }, []);

  // Repetir no borra nada de lo instalado: solo hace que el asistente vuelva
  // a enseñarse, por si hubo que instalar Redis/Qdrant en WSL después de la
  // primera vez y hace falta revisarlo sin desinstalar ni reconfigurar nada.
  function repetirSetup() {
    void api.setupReiniciar();
    setSetupListo(false);
    setDentro(false);
  }

  async function reanudar() {
    if (!pendiente) return;
    setReanudando(true);
    const { plan } = pendiente;
    try {
      await api.descargaArrancar(plan.indice_id, plan.nuevas, plan.presupuesto_eur, plan.imagenes_estimadas);
      setDescargaIndiceId(plan.indice_id);
      setImagenesEstimadas(plan.imagenes_estimadas);
      setPendiente(null);
      setDestino("descarga");
    } finally {
      setReanudando(false);
    }
  }

  async function descartarPendiente() {
    await api.descargaPendienteDescartar();
    setPendiente(null);
  }

  // Al terminar la descarga se salta a revisión SOLO si hay algo que revisar:
  // una descarga de puro street view no tiene sueltas, y mandar al operador a
  // una rejilla vacía sería un paso de más. Si no hay nada que revisar, se
  // queda en "descarga" — con `descargaIndiceId` ya a `null` esa pestaña pasa
  // a pintar el embebido a pantalla completa (#63), en vez de mandar a
  // Proyectos y dejar el embebido corriendo invisible de fondo.
  async function alTerminarDescarga() {
    const indiceId = descargaIndiceId ?? indiceAbierto ?? 0;
    setDescargaIndiceId(null);
    setImagenesEstimadas(null);
    const pendientes = await api.revisionPendientes(indiceId);
    if (pendientes.length > 0) setDestino("revision");
  }

  return (
    <WindowFrame>
      <div className="relative h-full w-full overflow-hidden bg-bg">
        {dentro && actualizacion && !actualizacionCerrada && (
          <ActualizacionBanner estado={actualizacion} onCerrar={() => setActualizacionCerrada(true)} />
        )}
        {!dentro && <PlanetBackground />}
        <div className="relative flex h-full items-center justify-center">
          {(!saludo || setupListo === null) && <Booting />}
          {saludo && setupListo === false && !dentro && (
            <SetupWizard
              saludo={saludo}
              onListo={() => {
                void api.setupMarcarCompleto();
                setSetupListo(true);
                setDentro(true);
              }}
            />
          )}
          {saludo && setupListo === true && !dentro && !serviciosFallo && !ofrecerIdentidad && (
            <ServicesBoot saludo={saludo} onListo={() => void traspasarServicios()} onFallo={setServiciosFallo} />
          )}
          {saludo && setupListo === true && !dentro && serviciosFallo && (
            <ServicesFailDialog
              mensaje={serviciosFallo}
              onListo={() => { setServiciosFallo(null); void traspasarServicios(); }}
              onReintentar={() => setServiciosFallo(null)}
              onAjustes={() => { setServiciosFallo(null); setDentro(true); setDestino("ajustes"); }}
            />
          )}
          {saludo && setupListo === true && !dentro && ofrecerIdentidad && (
            <IdentityStep onHecho={() => setDentro(true)} onSaltar={() => setDentro(true)} />
          )}
        </div>

        {dentro && (
          <div className="absolute inset-0">
            <Rail
              activo={destino}
              descargaActiva={descargaIndiceId !== null || pendiente !== null}
              embebiendoActivo={embebiendoActivo}
              onIr={(d) => { setDestino(d); if (d !== "descarga" && d !== "revision") { setIndiceAbierto(null); setNombreIndiceAbierto(""); } }}
            />
            <div className="absolute inset-y-0 left-11 right-0 flex flex-col">
              <div className="relative min-h-0 flex-1">
                {destino === "proyectos" && (
                  indiceAbierto === null
                    ? <ProjectsView onAbrir={setIndiceAbierto} />
                    : <IndexDetail key={indiceAbierto} id={indiceAbierto} onVolver={() => { setIndiceAbierto(null); setNombreIndiceAbierto(""); }}
                        onIrAEmbebido={() => setDestino("descarga")} />
                )}
                {/* Territorio trabaja SIEMPRE sobre un índice: sin esto, el
                    carril deja llegar a la pantalla sin haber elegido uno, y
                    lo que se dibuje ahí no tiene dónde ir — exactamente lo que
                    dejó 8868 imágenes huérfanas bajo un índice 0 que no
                    existe. `IndexPicker`, no `IndexList`: es un paso
                    intermedio para elegir y seguir, no el catálogo. */}
                {destino === "territorio" && indiceAbierto === null && (
                  <IndexPicker titulo="Dibujar territorio"
                    onAbrir={(id, nombre) => { setIndiceAbierto(id); setNombreIndiceAbierto(nombre); }} />
                )}
                {destino === "revision" && indiceAbierto === null && (
                  <IndexPicker titulo="Revisar imágenes"
                    onAbrir={(id) => setIndiceAbierto(id)} />
                )}
                {destino === "territorio" && indiceAbierto !== null && (
                  <TerritoryView
                    nombre={nombreIndiceAbierto}
                    indiceId={indiceAbierto}
                    onDescargando={(estimadas) => {
                      setDescargaIndiceId(indiceAbierto);
                      setImagenesEstimadas(estimadas);
                      setDestino("descarga");
                    }}
                  />
                )}
                {destino === "descarga" && (
                  (descargaIndiceId ?? indiceAbierto) === null
                    ? (
                      <div className="grid h-full place-items-center p-8">
                        {pendiente ? (
                          <div className="max-w-[320px] rounded-card border border-border bg-panel p-5 text-center">
                            <p className="text-[12.5px] text-fg">Se cerró a mitad de una descarga</p>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                              «{pendiente.nombre_indice}» se quedó a mitad. Lo que ya se bajó está a
                              salvo — reanudar sigue justo por donde iba, sin pagar dos veces.
                            </p>
                            <div className="mt-3.5 flex justify-center gap-2">
                              <button
                                onClick={() => void descartarPendiente()}
                                disabled={reanudando}
                                className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-subtle disabled:opacity-40"
                              >
                                Descartar
                              </button>
                              <button
                                onClick={() => void reanudar()}
                                disabled={reanudando}
                                className="jg-press rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
                              >
                                {reanudando ? "Reanudando…" : "Reanudar"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="max-w-[280px] text-center text-[12px] leading-relaxed text-muted">
                            Aquí se ve el progreso mientras se está descargando y embebiendo. Empieza
                            una descarga desde <b className="font-normal text-fg">Territorio</b>, o abre
                            un índice con trabajo pendiente desde <b className="font-normal text-fg">Proyectos</b>.
                          </p>
                        )}
                      </div>
                    )
                    : <DescargaYEmbebidoView
                        indiceId={(descargaIndiceId ?? indiceAbierto)!}
                        descargando={descargaIndiceId !== null}
                        imagenesEstimadas={imagenesEstimadas}
                        onTerminadoDescarga={() => void alTerminarDescarga()}
                        onCambiarIndice={() => { setIndiceAbierto(null); setNombreIndiceAbierto(""); setDestino("proyectos"); }}
                      />
                )}
                {destino === "revision" && indiceAbierto !== null && (
                  <ReviewGrid indiceId={indiceAbierto} onEmbeber={() => setDestino("proyectos")} />
                )}
                {destino === "ajustes" && saludo && (
                  <div className="flex h-full flex-col">
                    <div className="flex shrink-0 gap-1 border-b border-border px-6 pt-4">
                      {(["identidad", "servicios", "rendimiento", "almacenamiento", "origenes", "actualizaciones", "debug"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setPestana(t)}
                          className={`rounded-t-lg px-3.5 py-2 text-[11.5px] transition-colors
                            ${pestana === t ? "bg-white/[.07] text-fg" : "text-subtle hover:text-fg"}`}
                        >
                          {t === "identidad" ? "Identidad" : t === "servicios" ? "Servicios locales"
                            : t === "rendimiento" ? "Rendimiento" : t === "almacenamiento" ? "Almacenamiento"
                            : t === "origenes" ? "Orígenes de red" : t === "actualizaciones" ? "Actualizaciones" : "Debug"}
                        </button>
                      ))}
                    </div>
                    <div className="min-h-0 flex-1">
                      {pestana === "identidad" && <IdentityPanel />}
                      {pestana === "servicios" && <ServicesPanel so={saludo.so} />}
                      {pestana === "rendimiento" && <RendimientoPanel />}
                      {pestana === "almacenamiento" && <StoragePanel />}
                      {pestana === "origenes" && <OriginsPanel />}
                      {pestana === "actualizaciones" && <ActualizacionesPanel version={saludo.version} />}
                      {pestana === "debug" && <DebugPanel onRepetirSetup={repetirSetup} />}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {dentro && (
          <PublishToast onAbrir={(id) => { setDestino("proyectos"); setIndiceAbierto(id); }} />
        )}
      </div>
    </WindowFrame>
  );
}
