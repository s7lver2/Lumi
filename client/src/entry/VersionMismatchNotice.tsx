import { useEffect, useState } from "react";
import { api, versionMayor } from "../lib/api";
import { dispararActualizacionAVersion, historialActualizaciones } from "../lib/actualizaciones";

/** Popup — bloquea de verdad hasta que el investigador elige un camino, en
 *  vez de perderse entre el resto de la pantalla de login. Mismo lenguaje
 *  visual que `Pane`/`StatusOverlay` (marca ✦ + título a la izquierda,
 *  tarjeta de cristal `rgba(16,19,25,.66)` + `backdrop-blur-xl`) — es la
 *  identidad real del cliente, no la insignia circular de icono de
 *  `ConfirmarPeligro.tsx`, que es un diálogo de confirmación de admin
 *  aparte y nunca se ve durante el login/pairing.
 *
 *  Se monta igual en `LoginForm`, `AddServerForm` y `PairStep` cuando
 *  `pair`/`reconnect`/`pair_card` fallan por desajuste de versión — ver
 *  `connect()` en `client/src-tauri/src/main.rs` y la spec de
 *  compatibilidad de versión. Cliente más nuevo: dos caminos (pedir al
 *  servidor que actualice, o descargar la versión del servidor). Servidor
 *  más nuevo: uno solo (actualizar el cliente).
 *
 *  `onForzar` es la salida de emergencia: sin ella, un administrador cuyo
 *  servidor se atrasó no tenía NINGUNA forma de entrar a su propio panel
 *  de Actualizaciones a arreglarlo — el bloqueo de versión pasa antes de
 *  que exista sesión, así que ni loguearse podía. Vuelve a intentar el
 *  mismo pairing/login pero aceptando el desajuste esta vez. */
export function VersionMismatchModal({ propia, servidor, onClose, onForzar }: {
  propia: string; servidor: string; onClose: () => void; onForzar: () => Promise<void>;
}) {
  const clienteEsMasNuevo = versionMayor(propia, servidor);
  const [enviada, setEnviada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [forzando, setForzando] = useState(false);
  const [mostrarForzar, setMostrarForzar] = useState(false);
  const [textoConfirmar, setTextoConfirmar] = useState("");
  const confirmado = textoConfirmar.trim() === "CONTINUAR";

  // #122: antes se ofrecía "Actualizar cliente" con solo comparar números de
  // versión — si la del servidor no es en realidad una versión publicada de
  // verdad (typo, campo mal leído, servidor que anuncia una versión que
  // nunca salió), el botón disparaba una actualización a un destino que no
  // existe. Ahora se comprueba contra el historial real antes de ofrecerlo;
  // mientras tanto o si la comprobación falla, se avisa en vez de asumir.
  const [comprobando, setComprobando] = useState(!clienteEsMasNuevo);
  const [versionPublicada, setVersionPublicada] = useState<boolean | null>(null);
  useEffect(() => {
    if (clienteEsMasNuevo) return;
    let vivo = true;
    historialActualizaciones()
      .then((vs) => { if (vivo) setVersionPublicada(vs.some((v) => v.version === servidor && !v.retirada)); })
      .catch(() => { if (vivo) setVersionPublicada(null); })
      .finally(() => { if (vivo) setComprobando(false); });
    return () => { vivo = false; };
  }, [clienteEsMasNuevo, servidor]);

  async function forzar() {
    setForzando(true);
    setError(null);
    try {
      await onForzar();
    } catch (e) {
      setError(String(e));
      setForzando(false);
    }
  }

  async function pedirActualizacion() {
    setError(null);
    try {
      await api.post("/v1/version-mismatch", { version_cliente: propia });
      setEnviada(true);
    } catch (e) {
      setError(String(e));
    }
  }

  // Si sale bien, la app se cierra sola dentro del comando de Rust y nunca
  // llega a este `catch` — igual que en ActualizacionesSeccion.tsx.
  async function actualizar() {
    setAplicando(true);
    setError(null);
    try {
      await dispararActualizacionAVersion(servidor);
    } catch (e) {
      setError(String(e));
      setAplicando(false);
    }
  }

  return (
    // Fondo y tarjeta SÓLIDOS a propósito, no el cristal translúcido de
    // Pane/StatusOverlay: aquella tarjeta está pensada para sentarse UNA vez
    // sobre WavesBackground, y aquí se apila encima de un Pane que ya es
    // translúcido — dos capas de cristal juntas dejaban el texto de detrás
    // (título/botones del formulario) sangrando a través del popup,
    // ilegible y con los clics cayendo en el elemento equivocado.
    // z-[70], no z-[60]: la barra de título (`TitleBar.tsx`) también usa
    // z-[60] — con el mismo valor, cuál gana depende del orden en el DOM en
    // vez de la intención ("este popup bloquea todo"), frágil ante un
    // reordenamiento futuro. Este aviso debe quedar SIEMPRE por encima.
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-bg/95 p-6"
      style={{ animation: "jg-backdrop-in .28s ease both" }}>
      <div className="w-full max-w-sm" style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mb-1 flex items-center justify-center gap-2.5">
          <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
          <span className="text-[17px] font-medium text-fg">Versión incompatible</span>
        </div>
        <p className="mb-6 text-center text-xs text-muted">
          Este cliente ({propia}) no coincide con la versión del servidor ({servidor}).
        </p>

        <div className="rounded-card border border-border bg-panel p-5 shadow-lg shadow-black/40">
          {error && <p className="mb-3 break-words text-center text-xs text-danger-fg">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {clienteEsMasNuevo && (
              enviada ? (
                <span className="mr-auto text-[11px] text-subtle">Solicitud enviada al servidor</span>
              ) : (
                <button onClick={() => void pedirActualizacion()}
                  className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg">
                  Pedir al servidor que actualice
                </button>
              )
            )}
            <button onClick={onClose}
              className="jg-press rounded-lg px-3.5 py-1.5 text-[11px] text-subtle">
              Cerrar
            </button>
            <button onClick={() => void actualizar()}
              disabled={aplicando || (!clienteEsMasNuevo && (comprobando || versionPublicada === false))}
              title={!clienteEsMasNuevo && versionPublicada === false
                ? `El servidor dice usar la versión ${servidor}, pero no está entre las publicadas — puede ser un falso positivo`
                : undefined}
              className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
              {aplicando ? "Aplicando…"
                : clienteEsMasNuevo ? "Descargar versión del servidor"
                : comprobando ? "Comprobando…" : "Actualizar cliente"}
            </button>
          </div>
          {/* Capability matrix pattern (ARCHITECTURE.md): si el botón de
              arriba está deshabilitado, la razón real se ve aquí, no se
              esconde — nunca "no pasa nada" al pulsarlo. */}
          {!clienteEsMasNuevo && versionPublicada === false && (
            <p className="mt-2 text-right text-[10.5px] text-danger-fg">
              La versión {servidor} no está entre las publicadas del cliente — puede ser un falso
              positivo; revisa la versión del servidor antes de forzar una actualización.
            </p>
          )}

          {/* Salida de emergencia, deliberadamente discreta y separada del
              resto: es la única forma de que un admin entre a su propio
              panel si el servidor se atrasó, pero no es el camino normal —
              escribir CONTINUAR es la misma fricción que ConfirmarPeligro.tsx
              usa para cualquier acción que se salta una protección. */}
          <div className="mt-4 border-t border-border pt-3">
            {!mostrarForzar ? (
              <button onClick={() => setMostrarForzar(true)}
                className="text-[10.5px] text-subtle underline-offset-2 hover:text-fg hover:underline">
                Entrar de todas formas (arriesgado)
              </button>
            ) : (
              <div>
                <p className="mb-1.5 text-[10.5px] text-muted">
                  Vas a usar este cliente con un servidor de otra versión sin resolver el
                  desajuste. Escribe <b className="font-mono text-fg">CONTINUAR</b> para seguir.
                </p>
                <div className="flex items-center gap-2">
                  <input value={textoConfirmar} onChange={(e) => setTextoConfirmar(e.target.value)}
                    placeholder="CONTINUAR"
                    className="w-full rounded-lg border border-border bg-[#0d0f12] px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-white/40" />
                  <button onClick={() => void forzar()} disabled={!confirmado || forzando}
                    className="jg-press shrink-0 rounded-lg border border-danger/40 px-3 py-1.5 text-[11px] text-danger-fg disabled:opacity-40">
                    {forzando ? "Entrando…" : "Entrar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
